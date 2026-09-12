#!/usr/bin/env python3
"""Download the pinned Zclassic research snapshot; Python 3.10+, stdlib only.

Usage: python3 scripts/fetch-chainstate.py /private/tmp/zcl-snapshot

Maintenance utility only: run against a separate, stopped-node directory, never
inside Cloud Run. Downloads only chainstate/, with at most 500 MB requested per
run. Reruns resume completed files only after checking their SHA-256. A successful
download verifies transport hashes, NOT the compiled chainstate commitment; run
export-state.mjs afterward before using balances.

Original implementation for zclthesis. Wire format follows the MIT-licensed
Zclassic v2.1.2-beta6 sources (not copied implementation):
https://github.com/ZclassicCommunity/zclassic/blob/v2.1.2-beta6/src/protocol.h
https://github.com/ZclassicCommunity/zclassic/blob/v2.1.2-beta6/src/bootstrap.cpp
https://github.com/ZclassicCommunity/zclassic/blob/v2.1.2-beta6/src/chainparams.cpp
"""

import argparse
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import struct
import sys
import threading
import time


PEERS = ("74.50.74.102", "205.209.104.118")
PORT = 8033
MAGIC = bytes.fromhex("24e92764")
RELEASE = "v2.1.2-beta6"
ANCHOR = {
    "height": 3126937,
    "blockhash": "00000663e40f1fe0bc32a7e7282fac25de5fe8ecefd9c627e2fd948d388f7053",
    "anchor_sha256": "376d6d5e6f7d02459b89ae0988f5c51bb1deaf2a3e4b3a1de745e4f2e3bb279d",
    "anchor_sha3": "0f7d542e5c662c9652b93eef8eb98e386e8bdbd2f848eba0e99c6451eb2ef0bd",
    "chainstate_hash": "4efb67005d842e9d5bab21831fef8905a7fcb89e7264e43bd1aa00623f5a585f",
}
MAX_BYTES = 500_000_000
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_FILES = 10_000
MAX_FRAME = 2 * 1024 * 1024
MAX_CHUNK = 1024 * 1024
SAFE_COMPONENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*\Z")
CHAINSTATE_FILE = re.compile(r"(?:CURRENT|LOCK|LOG(?:\.old)?|MANIFEST-[0-9]+|[0-9]+\.(?:ldb|sst|log))\Z")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def double_sha(data):
    return hashlib.sha256(hashlib.sha256(data).digest()).digest()


class Reader:
    def __init__(self, data):
        self.data, self.offset = data, 0

    def read(self, length):
        require(0 <= length <= len(self.data) - self.offset, "Truncated payload")
        result = self.data[self.offset:self.offset + length]
        self.offset += length
        return result

    def number(self, kind):
        return struct.unpack("<" + kind, self.read(struct.calcsize("<" + kind)))[0]

    def size(self, limit):
        first = self.number("B")
        value = first if first < 253 else self.number({253: "H", 254: "I", 255: "Q"}[first])
        minimum = {253: 253, 254: 65536, 255: 4294967296}.get(first, 0)
        require(minimum <= value <= limit, "Noncanonical or excessive CompactSize")
        return value

    def string(self, limit):
        return self.read(self.size(limit)).decode("ascii")

    def hash(self):
        return self.read(32)[::-1].hex()

    def finish(self):
        require(self.offset == len(self.data), "Unexpected trailing payload")


def parse_manifest(payload):
    reader = Reader(payload)
    version = reader.number("i")
    require(version in (1, 2, 3), "Unsupported snapshot manifest version")
    result = {
        "version": version,
        "network": reader.string(32),
        "height": reader.number("i"),
        "blockhash": reader.hash(),
        "anchor_sha256": reader.hash(),
        "anchor_sha3": reader.hash(),
        "size": reader.number("Q"),
        "chunk_size": reader.number("I"),
        "files": [],
    }
    names = set()
    for _ in range(reader.size(MAX_FILES)):
        name, size, digest = reader.string(256), reader.number("Q"), reader.hash()
        parts = name.split("/")
        require(2 <= len(parts) <= 3 and all(SAFE_COMPONENT.fullmatch(p) for p in parts),
                "Unsafe manifest path")
        require(parts[0] in ("blocks", "chainstate"), "Unexpected manifest directory")
        require(name not in names, "Duplicate manifest path")
        require(size <= 32 * 1024**3 and digest != "0" * 64, "Invalid manifest file")
        names.add(name)
        result["files"].append({"path": name, "size": size, "sha256": digest})
    if version >= 2:
        result["chainstate_hash"] = reader.hash()
    if version >= 3:
        result.update(block_tip_height=reader.number("i"), block_tip_hash=reader.hash())
    reader.finish()
    require(result["network"] == "main", "Wrong network")
    for key, expected in ANCHOR.items():
        if key == "chainstate_hash" and version == 1:
            continue  # v1 omits this field; the exporter still requires the compiled hash.
        require(result[key] == expected, "Snapshot differs from pinned anchor: " + key)
    require(0 < result["chunk_size"] <= MAX_CHUNK, "Excessive chunk size")
    require(sum(f["size"] for f in result["files"]) == result["size"] <= 200 * 1024**3,
            "Inconsistent or excessive manifest total")
    selected = chainstate_files(result)
    require(selected and 0 < sum(f["size"] for _, f in selected) <= MAX_BYTES,
            "Chainstate exceeds 500 MB or is empty")
    for _, entry in selected:
        parts = entry["path"].split("/")
        require(len(parts) == 2 and CHAINSTATE_FILE.fullmatch(parts[1]), "Unexpected chainstate filename")
        require(entry["size"] <= MAX_FILE_BYTES, "Excessive chainstate file size")
    require("chainstate/CURRENT" in names and any(f["path"].endswith((".ldb", ".sst")) for _, f in selected),
            "Missing LevelDB metadata or tables")
    return result


def chainstate_files(manifest):
    return [(index, entry) for index, entry in enumerate(manifest["files"])
            if entry["path"].startswith("chainstate/")]


def send(sock, command, payload=b""):
    sock.sendall(MAGIC + command.encode("ascii").ljust(12, b"\0")
                 + struct.pack("<I", len(payload)) + double_sha(payload)[:4] + payload)


def read_exact(sock, length):
    result = bytearray()
    deadline = time.monotonic() + 30
    while len(result) < length:
        remaining = deadline - time.monotonic()
        require(remaining > 0, "Peer read deadline exceeded")
        sock.settimeout(remaining)
        chunk = sock.recv(length - len(result))
        if not chunk:
            raise EOFError("Peer closed connection")
        result.extend(chunk)
    return bytes(result)


def receive(sock, wanted):
    for _ in range(16):
        header = read_exact(sock, 24)
        require(header[:4] == MAGIC, "Wrong network frame")
        command = header[4:16].rstrip(b"\0").decode("ascii")
        length = struct.unpack("<I", header[16:20])[0]
        require(length <= MAX_FRAME, "Excessive network frame")
        if command != wanted:
            require(length <= 4096, "Excessive unsolicited message")
        payload = read_exact(sock, length)
        require(double_sha(payload)[:4] == header[20:24], "Network checksum mismatch")
        if command == "ping":
            require(length == 8, "Invalid ping")
            send(sock, "pong", payload)
        if command == wanted:
            return payload
    raise ValueError("Too many unsolicited messages")


def connect(peer):
    require(peer in PEERS, "Peer is not allowlisted")
    sock = socket.create_connection((peer, PORT), timeout=10)
    try:
        def address(ip, port):
            return struct.pack("<Q", 0) + b"\0" * 10 + b"\xff\xff" + socket.inet_aton(ip) + struct.pack(">H", port)
        agent = b"/myzclthesis-research:0.1/"
        version = (struct.pack("<iQq", 170011, 0, int(time.time())) + address(peer, PORT)
                   + address("0.0.0.0", 0) + secrets.token_bytes(8) + bytes([len(agent)])
                   + agent + struct.pack("<i?", 0, True))
        send(sock, "version", version)
        response = receive(sock, "version")
        require(80 <= len(response) <= 1024, "Invalid version message")
        protocol, services = struct.unpack("<iQ", response[:12])
        require(protocol >= 170011 and services & (1 << 24), "Peer cannot serve bootstrap snapshots")
        send(sock, "verack")
        require(receive(sock, "verack") == b"", "Invalid verack")
        return sock
    except BaseException:
        sock.close()
        raise


def request_manifest(sock):
    send(sock, "getbsman")
    return parse_manifest(receive(sock, "bsman"))


def safe_target(root, relative):
    target = root / relative
    require(target.parent == root or target.parent == root / "chainstate", "Unexpected local destination")
    require(not target.parent.is_symlink(), "Refusing symlink directory")
    if target.exists() or target.is_symlink():
        require(stat.S_ISREG(target.lstat().st_mode), "Refusing nonregular file: " + str(target))
    return target


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(MAX_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_file(root, entry):
    target = safe_target(root, entry["path"])
    return target.exists() and target.stat().st_size == entry["size"] and sha256_file(target) == entry["sha256"]


def atomic_json(root, name, value):
    target = safe_target(root, name)
    temporary = safe_target(root, name + ".part")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
    with os.fdopen(os.open(temporary, flags, 0o600), "w") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")
    temporary.replace(target)


class Transfer:
    def __init__(self, root, manifest, attempts):
        self.root, self.manifest, self.attempts = root, manifest, attempts
        self.lock, self.abort = threading.Lock(), threading.Event()
        self.requested, self.completed = 0, 0
        self.peers = set()

    def check(self):
        if self.abort.is_set():
            raise RuntimeError("Download cancelled")

    def reserve(self, length):
        self.check()
        with self.lock:
            require(self.requested + length <= MAX_BYTES, "500 MB request budget exhausted; rerun to resume")
            self.requested += length

    def download_file(self, sock, index, entry):
        target = safe_target(self.root, entry["path"])
        temporary = safe_target(self.root, entry["path"] + ".part")
        flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
        digest, pending, offset, written = hashlib.sha256(), deque(), 0, 0
        with os.fdopen(os.open(temporary, flags, 0o600), "wb") as stream:
            while pending or offset < entry["size"]:
                self.check()
                while len(pending) < 8 and offset < entry["size"]:
                    length = min(self.manifest["chunk_size"], entry["size"] - offset)
                    self.reserve(length)
                    send(sock, "getbschk", struct.pack("<IQI", index, offset, length))
                    pending.append((offset, length))
                    offset += length
                expected_offset, length = pending.popleft()
                reader = Reader(receive(sock, "bschk"))
                require(reader.number("I") == index and reader.number("Q") == expected_offset,
                        "Unexpected snapshot chunk")
                payload = reader.read(reader.size(MAX_CHUNK))
                reader.finish()
                require(len(payload) == length, "Wrong snapshot chunk length")
                stream.write(payload)
                digest.update(payload)
                written += len(payload)
        require(written == entry["size"] and digest.hexdigest() == entry["sha256"],
                "File hash mismatch: " + entry["path"])
        safe_target(self.root, entry["path"])
        temporary.replace(target)
        with self.lock:
            self.completed += written
            if self.completed // 25_000_000 != (self.completed - written) // 25_000_000:
                print(f"Verified {self.completed / 1_000_000:.1f} MB in this run", flush=True)

    def worker(self, group_number, entries):
        last_error = None
        for attempt in range(self.attempts):
            self.check()
            remaining = [(index, entry) for index, entry in entries if not verified_file(self.root, entry)]
            if not remaining:
                return
            peer = PEERS[(group_number + attempt) % len(PEERS)]
            try:
                with connect(peer) as sock:
                    require(request_manifest(sock) == self.manifest, "Peer manifest changed; rerun to obtain a new manifest")
                    with self.lock:
                        self.peers.add(peer)
                    for index, entry in remaining:
                        self.download_file(sock, index, entry)
                return
            except (OSError, EOFError, ValueError) as error:
                last_error = error
                print(f"{peer}: attempt {attempt + 1}/{self.attempts} failed: {error}", file=sys.stderr, flush=True)
                if attempt + 1 < self.attempts and self.abort.wait(15):
                    self.check()
        raise RuntimeError(f"Download retries exhausted: {last_error}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("output_dir", type=Path, help="Isolated destination; contains chainstate/ and provenance JSON")
    parser.add_argument("--connections", type=int, choices=range(1, 9), default=6,
                        help="Total parallel connections across the two peers (default: 6)")
    parser.add_argument("--attempts", type=int, choices=range(1, 6), default=4,
                        help="Maximum connection attempts per worker (default: 4)")
    args = parser.parse_args()
    require(not args.output_dir.is_symlink(), "Output directory must not be a symlink")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    root = args.output_dir.resolve()
    state_dir = root / "chainstate"
    require(not state_dir.is_symlink(), "Chainstate directory must not be a symlink")
    state_dir.mkdir(exist_ok=True)
    manifest = None
    for peer in PEERS:
        try:
            with connect(peer) as sock:
                manifest = request_manifest(sock)
            break
        except (OSError, EOFError, ValueError) as error:
            print(f"Manifest from {peer} unavailable: {error}", file=sys.stderr)
    require(manifest is not None, "Neither pinned peer supplied an acceptable manifest")
    entries = chainstate_files(manifest)
    expected_names = {entry["path"].split("/")[1] for _, entry in entries}
    for existing in state_dir.iterdir():
        name = existing.name.removesuffix(".part")
        require(name in expected_names and stat.S_ISREG(existing.lstat().st_mode),
                "Unexpected chainstate entry; use a separate output directory: " + existing.name)
    atomic_json(root, "bootstrap-manifest.json", manifest)
    transfer = Transfer(root, manifest, args.attempts)
    groups = [[] for _ in range(args.connections)]
    for count, entry in enumerate(sorted(entries, key=lambda item: -item[1]["size"])):
        groups[count % args.connections].append(entry)
    executor = ThreadPoolExecutor(max_workers=args.connections)
    try:
        futures = [executor.submit(transfer.worker, index, group) for index, group in enumerate(groups) if group]
        for future in as_completed(futures):
            future.result()
    finally:
        transfer.abort.set()
        executor.shutdown(wait=True, cancel_futures=True)
    for _, entry in entries:
        require(verified_file(root, entry), "Final verification failed: " + entry["path"])
    current = safe_target(root, "chainstate/CURRENT").read_bytes()
    require(re.fullmatch(rb"MANIFEST-[0-9]+\n", current) is not None, "Invalid LevelDB CURRENT")
    require(current.decode("ascii").strip() in expected_names, "CURRENT references a missing manifest")
    receipt = {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "release": RELEASE,
        "peers": [f"{peer}:{PORT}" for peer in sorted(transfer.peers)],
        "height": ANCHOR["height"],
        "blockhash": ANCHOR["blockhash"],
        "block_at": "2026-05-27T17:31:18Z",
        "file_count": len(entries),
        "verified_bytes": sum(entry["size"] for _, entry in entries),
        "requested_bytes_this_run": transfer.requested,
        "compiled_chainstate_full_hash": ANCHOR["chainstate_hash"],
        "commitment_verification": "pending independent exporter; transport file hashes verified only",
    }
    atomic_json(root, "chainstate-download-receipt.json", receipt)
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, EOFError, ValueError, RuntimeError) as error:
        print(f"Download incomplete: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Download interrupted; rerun to resume verified files.", file=sys.stderr)
        sys.exit(130)
