#!/usr/bin/env python3
"""First-party event counts and a private, read-only analytics dashboard."""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import stat
import sys
import threading
from urllib.parse import parse_qs, urlsplit
import uuid


ORIGINS = frozenset({
    'https://zclthesis.com', 'https://www.zclthesis.com',
    'https://myzclthesis-633108169526.us-central1.run.app',
})
ADMIN_HOSTS = frozenset(f'{host}:{port}' for host in ('localhost', '127.0.0.1')
                        for port in (8091, 18091))
PATHS = ('/', '/es/', '/network/', '/es/network/')
SOURCES = ('direct', 'internal', 'search', 'social', 'github', 'nonkyc',
           'zclassic', 'zcash', 'other')
EVENT_TYPES = ('pageview', 'referral_click')
FIELDS = frozenset({'id', 'visitor', 'session', 'type', 'path', 'source'})
MAX_BODY_BYTES = 2048
DAILY_LIMIT = 50000
VISITOR_DAILY_LIMIT = 300
VISITOR_CLICK_LIMIT = 30
RETENTION_DAYS = 90
MAX_CONNECTIONS = 32
ASSETS = {'/': ('dashboard.html', 'text/html; charset=utf-8'),
          '/dashboard.html': ('dashboard.html', 'text/html; charset=utf-8'),
          '/dashboard.css': ('dashboard.css', 'text/css; charset=utf-8'),
          '/dashboard.js': ('dashboard.js', 'text/javascript; charset=utf-8')}


class InvalidEvent(ValueError):
    pass


class RateLimited(Exception):
    pass


class StoreUnavailable(Exception):
    pass


def utc_now():
    return datetime.now(timezone.utc)


def timestamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def validate_event(value):
    if type(value) is not dict or value.keys() != FIELDS:
        raise InvalidEvent('Invalid event schema')
    if any(type(field) is not str for field in value.values()):
        raise InvalidEvent('Event fields must be strings')
    normalized = dict(value)
    for field in ('id', 'visitor', 'session'):
        identifier = value[field]
        if not re.fullmatch(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}', identifier):
            raise InvalidEvent('Identifiers must be UUIDv4 strings')
        parsed = uuid.UUID(identifier)
        if parsed.version != 4 or parsed.variant != uuid.RFC_4122:
            raise InvalidEvent('Identifiers must be UUIDv4 strings')
        normalized[field] = str(parsed)
    if value['type'] not in EVENT_TYPES or value['path'] not in PATHS or value['source'] not in SOURCES:
        raise InvalidEvent('Invalid event category')
    if value['type'] == 'referral_click' and value['path'] not in ('/', '/es/'):
        raise InvalidEvent('Referral clicks are restricted to thesis pages')
    return normalized


def decode_event(raw):
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise InvalidEvent('Duplicate JSON key')
            result[key] = value
        return result
    try:
        value = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_object)
        return validate_event(value)
    except (UnicodeError, ValueError, RecursionError) as error:
        raise InvalidEvent('Invalid event JSON') from error


def validate_relay_token(token):
    if type(token) is not str or not re.fullmatch(r'[0-9a-fA-F]{64}', token):
        raise ValueError('A 64-hex relay token is required')
    return token


class EventStore:
    """Connections are per operation; IMMEDIATE transactions serialize caps."""

    def __init__(self, path, clock=utc_now):
        self.path = Path(path).absolute()
        self.clock = clock
        self.collection_failed = threading.Event()
        missing = []
        parent = self.path.parent
        while not parent.exists():
            missing.append(parent)
            parent = parent.parent
        for directory in reversed(missing):
            directory.mkdir(mode=0o700)
        if not self.path.parent.is_dir() or stat.S_IMODE(self.path.parent.stat().st_mode) & 0o077:
            raise StoreUnavailable('Analytics data directory must be private')
        try:
            descriptor = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            if not stat.S_ISREG(self.path.lstat().st_mode):
                raise StoreUnavailable('Analytics database must be a regular file')
        else:
            os.close(descriptor)
        os.chmod(self.path, 0o600)
        with self._connection() as db:
            if db.execute('PRAGMA journal_mode=WAL').fetchone()[0] != 'wal':
                raise StoreUnavailable('Analytics requires WAL mode')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    occurred_at TEXT NOT NULL,
                    day TEXT NOT NULL,
                    visitor_hash TEXT NOT NULL,
                    session_hash TEXT NOT NULL,
                    event_type TEXT NOT NULL CHECK(event_type IN ('pageview', 'referral_click')),
                    path TEXT NOT NULL CHECK(path IN ('/', '/es/', '/network/', '/es/network/')),
                    source TEXT NOT NULL CHECK(source IN ('direct', 'internal', 'search', 'social', 'github', 'nonkyc', 'zclassic', 'zcash', 'other'))
                );
                CREATE INDEX IF NOT EXISTS events_day ON events(day);
                CREATE INDEX IF NOT EXISTS events_visitor_day ON events(visitor_hash, day, event_type);
                CREATE INDEX IF NOT EXISTS events_occurred_at ON events(occurred_at);
            ''')
            db.execute('BEGIN IMMEDIATE')
            now = self.clock().astimezone(timezone.utc)
            db.execute("INSERT OR IGNORE INTO metadata(key, value) VALUES ('recording_started', ?)",
                       (timestamp(now),))
            self._prune_locked(db, now.date())
            db.commit()

    @contextmanager
    def _connection(self):
        db = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        try:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA busy_timeout=5000')
            db.execute('PRAGMA synchronous=FULL')
            yield db
        finally:
            db.close()

    @staticmethod
    def _prune_locked(db, today):
        previous = db.execute("SELECT value FROM metadata WHERE key='last_pruned_day'").fetchone()
        if previous and previous[0] == today.isoformat():
            return
        cutoff = (today - timedelta(days=RETENTION_DAYS - 1)).isoformat()
        db.execute('DELETE FROM events WHERE day < ?', (cutoff,))
        db.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES ('last_pruned_day', ?)",
                   (today.isoformat(),))

    def prune(self, now=None):
        now = now or self.clock().astimezone(timezone.utc)
        with self._connection() as db:
            previous = db.execute("SELECT value FROM metadata WHERE key='last_pruned_day'").fetchone()
            if previous and previous[0] == now.date().isoformat():
                return
            db.execute('BEGIN IMMEDIATE')
            self._prune_locked(db, now.date())
            db.commit()

    def record(self, event):
        event = validate_event(event)
        now = self.clock().astimezone(timezone.utc)
        day = now.date().isoformat()
        visitor = hashlib.sha256(event['visitor'].encode('ascii')).hexdigest()
        session = hashlib.sha256(event['session'].encode('ascii')).hexdigest()
        try:
            with self._connection() as db:
                db.execute('BEGIN IMMEDIATE')
                self._prune_locked(db, now.date())
                if db.execute('SELECT 1 FROM events WHERE event_id=?', (event['id'],)).fetchone():
                    db.commit()
                    self.collection_failed.clear()
                    return False
                daily = db.execute('SELECT COUNT(*) FROM events WHERE day=?', (day,)).fetchone()[0]
                browser = db.execute('''SELECT COUNT(*), COALESCE(SUM(event_type='referral_click'),0)
                    FROM events WHERE visitor_hash=? AND day=?''', (visitor, day)).fetchone()
                if (daily >= DAILY_LIMIT or browser[0] >= VISITOR_DAILY_LIMIT
                        or event['type'] == 'referral_click' and browser[1] >= VISITOR_CLICK_LIMIT):
                    # Retention maintenance is safe even when this event is capped.
                    db.commit()
                    raise RateLimited()
                db.execute('''INSERT INTO events
                    (event_id,occurred_at,day,visitor_hash,session_hash,event_type,path,source)
                    VALUES (?,?,?,?,?,?,?,?)''',
                    (event['id'], timestamp(now), day, visitor, session, event['type'], event['path'], event['source']))
                db.commit()
            self.collection_failed.clear()
            return True
        except (sqlite3.Error, OSError) as error:
            self.collection_failed.set()
            raise StoreUnavailable('Collection storage unavailable') from error

    def health(self):
        if self.collection_failed.is_set():
            raise StoreUnavailable('Collection storage unavailable')
        try:
            with self._connection() as db:
                row = db.execute("SELECT value FROM metadata WHERE key='recording_started'").fetchone()
                if not row:
                    raise StoreUnavailable('Recording metadata unavailable')
        except (sqlite3.Error, OSError) as error:
            raise StoreUnavailable('Analytics storage unavailable') from error

    def summary(self, days):
        if type(days) is not int or days not in (1, 7, 30, 90):
            raise ValueError('Invalid summary range')
        self.health()
        now = self.clock().astimezone(timezone.utc)
        today = now.date()
        first = today - timedelta(days=days - 1)
        interval = (first.isoformat(), today.isoformat())
        try:
            self.prune(now)
            with self._connection() as db:
                db.execute('BEGIN')
                started = db.execute("SELECT value FROM metadata WHERE key='recording_started'").fetchone()[0]
                totals = dict(db.execute('''SELECT COUNT(DISTINCT visitor_hash) AS visitors,
                    COUNT(DISTINCT session_hash) AS visits,
                    COALESCE(SUM(event_type='pageview'),0) AS pageviews,
                    COALESCE(SUM(event_type='referral_click'),0) AS referralClicks,
                    COUNT(DISTINCT CASE WHEN event_type='referral_click' THEN session_hash END) AS clickingVisits
                    FROM events WHERE day BETWEEN ? AND ?''', interval).fetchone())
                daily_rows = {row['date']: dict(row) for row in db.execute('''SELECT day AS date,
                    COUNT(DISTINCT visitor_hash) AS visitors, COUNT(DISTINCT session_hash) AS visits,
                    SUM(event_type='pageview') AS pageviews, SUM(event_type='referral_click') AS referralClicks
                    FROM events WHERE day BETWEEN ? AND ? GROUP BY day''', interval)}
                page_rows = {row['path']: dict(row) for row in db.execute('''SELECT path,
                    SUM(event_type='pageview') AS pageviews, SUM(event_type='referral_click') AS referralClicks
                    FROM events WHERE day BETWEEN ? AND ? GROUP BY path''', interval)}
                source_rows = {row['source']: dict(row) for row in db.execute('''SELECT source,
                    COUNT(DISTINCT session_hash) AS visits, SUM(event_type='referral_click') AS referralClicks
                    FROM events WHERE day BETWEEN ? AND ? GROUP BY source''', interval)}
                last = db.execute('SELECT MAX(occurred_at) FROM events').fetchone()[0]
                db.commit()
            totals['clickRate'] = totals['clickingVisits'] / totals['visits'] * 100 if totals['visits'] else 0
            daily = []
            for offset in range(days):
                date = (first + timedelta(days=offset)).isoformat()
                daily.append(daily_rows.get(date, {'date': date, 'visitors': 0, 'visits': 0,
                                                   'pageviews': 0, 'referralClicks': 0}))
            return {'recordingStarted': started, 'generatedAt': timestamp(now), 'days': days,
                    'from': interval[0], 'to': interval[1], 'totals': totals, 'daily': daily,
                    'pages': [page_rows.get(path, {'path': path, 'pageviews': 0, 'referralClicks': 0}) for path in PATHS],
                    'sources': [source_rows.get(source, {'source': source, 'visits': 0, 'referralClicks': 0}) for source in SOURCES],
                    'lastEventAt': last}
        except (sqlite3.Error, OSError, TypeError) as error:
            raise StoreUnavailable('Analytics summary unavailable') from error


class PrivateHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, *args, **kwargs):
        self.connection_slots = threading.BoundedSemaphore(MAX_CONNECTIONS)
        super().__init__(*args, **kwargs)

    def process_request(self, request, client_address):
        if not self.connection_slots.acquire(blocking=False):
            try:
                request.settimeout(1)
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n')
            except OSError:
                pass
            finally:
                self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.connection_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.connection_slots.release()

    def handle_error(self, request, client_address):
        # Do not print client addresses, headers, payloads or query strings.
        sys.stderr.write('Analytics request failed.\n')


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, format, *args):
        pass

    def version_string(self):
        return 'ZclAnalytics'

    def respond(self, status, body=b'', content_type='application/json; charset=utf-8'):
        self.close_connection = True
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Connection', 'close')
        if body:
            self.send_header('Content-Type', content_type)
        if self.server.mode == 'admin':
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        if status == 429:
            self.send_header('Retry-After', '86400')
        self.end_headers()
        if body and self.command != 'HEAD':
            self.wfile.write(body)

    def json_response(self, status, value):
        self.respond(status, json.dumps(value, separators=(',', ':'), allow_nan=False).encode('utf-8'))

    def error_response(self, status, label):
        self.json_response(status, {'error': label})

    def dispatch(self):
        if self.server.mode == 'admin':
            hosts = self.headers.get_all('Host', [])
            origins = self.headers.get_all('Origin', [])
            if (len(hosts) != 1 or hosts[0] not in ADMIN_HOSTS
                    or origins and (len(origins) != 1 or origins[0] != 'http://' + hosts[0])):
                self.error_response(403, 'forbidden')
                return
            if self.command != 'GET':
                self.error_response(405, 'method_not_allowed')
                return
            self.admin_get()
            return
        if self.command == 'POST':
            authorization = self.headers.get_all('Authorization', [])
            expected = ('Bearer ' + self.server.relay_token).encode('ascii')
            if len(authorization) != 1 or not hmac.compare_digest(authorization[0].encode('latin-1'), expected):
                self.error_response(401, 'unauthorized')
                return
        origins = self.headers.get_all('Origin', [])
        if len(origins) != 1 or origins[0] not in ORIGINS:
            self.error_response(403, 'forbidden')
            return
        if self.command != 'POST':
            self.error_response(405, 'method_not_allowed')
            return
        if self.path != '/event':
            self.error_response(404, 'not_found')
            return
        self.collect()

    def collect(self):
        types = self.headers.get_all('Content-Type', [])
        if len(types) != 1 or types[0].split(';', 1)[0].strip().lower() != 'application/json':
            self.error_response(415, 'json_required')
            return
        lengths = self.headers.get_all('Content-Length', [])
        if self.headers.get_all('Transfer-Encoding') or len(lengths) != 1 or not re.fullmatch(r'[0-9]+', lengths[0]):
            self.error_response(400, 'invalid_length')
            return
        if len(lengths[0]) > 10 or int(lengths[0]) > MAX_BODY_BYTES:
            self.error_response(413, 'body_too_large')
            return
        length = int(lengths[0])
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise InvalidEvent('Incomplete body')
            event = decode_event(raw)
            self.server.store.record(event)
        except (InvalidEvent, TimeoutError):
            self.error_response(400, 'invalid_event')
        except RateLimited:
            self.error_response(429, 'daily_limit')
        except (StoreUnavailable, sqlite3.Error, OSError):
            self.error_response(503, 'collection_unavailable')
        else:
            self.respond(204)

    def admin_get(self):
        try:
            if not self.path.startswith('/'):
                raise ValueError('Invalid target')
            target = urlsplit(self.path)
            if target.scheme or target.netloc or target.fragment:
                raise ValueError('Invalid target')
            if target.path == '/favicon.ico' and not target.query:
                self.respond(204)
            elif target.path == '/health' and not target.query:
                self.server.store.health()
                self.json_response(200, {'ok': True})
            elif target.path == '/api/summary':
                query = parse_qs(target.query, keep_blank_values=True, strict_parsing=True, max_num_fields=2)
                if set(query) != {'days'} or len(query['days']) != 1 or query['days'][0] not in ('1', '7', '30', '90'):
                    raise ValueError('Invalid range')
                self.json_response(200, self.server.store.summary(int(query['days'][0])))
            elif target.path in ASSETS:
                filename, content_type = ASSETS[target.path]
                self.respond(200, (self.server.assets / filename).read_bytes(), content_type)
            else:
                self.error_response(404, 'not_found')
        except ValueError:
            self.error_response(400, 'invalid_request')
        except (StoreUnavailable, sqlite3.Error, OSError):
            self.error_response(503, 'analytics_unavailable')

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = dispatch


def create_server(store, mode, port=None, assets=None, relay_token=None):
    if mode not in ('collector', 'admin'):
        raise ValueError('Unknown server mode')
    if mode == 'collector':
        relay_token = validate_relay_token(relay_token)
    if port is None:
        port = 8792 if mode == 'collector' else 8091
    server = PrivateHTTPServer(('127.0.0.1', port), Handler)
    server.store = store
    server.mode = mode
    server.relay_token = relay_token
    server.assets = Path(assets) if assets is not None else Path(__file__).resolve().parent
    return server


def main():
    os.umask(0o077)
    stopped = threading.Event()
    for signum in (signal.SIGINT, signal.SIGTERM):
        signal.signal(signum, lambda *_: stopped.set())
    servers = []
    threads = []
    try:
        relay_token = validate_relay_token(os.environ.get('ZCL_ANALYTICS_RELAY_TOKEN'))
        store = EventStore(os.environ.get('ZCL_ANALYTICS_DB', 'data/analytics.sqlite3'))
        servers.append(create_server(store, 'collector', relay_token=relay_token))
        servers.append(create_server(store, 'admin'))
        for server in servers:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            threads.append(thread)
        while not stopped.wait(60):
            try:
                store.prune()
            except (sqlite3.Error, OSError):
                store.collection_failed.set()
                sys.stderr.write('Analytics retention maintenance unavailable.\n')
    except (StoreUnavailable, sqlite3.Error, OSError, ValueError):
        sys.stderr.write('Analytics service unavailable.\n')
        return 1
    finally:
        for server, thread in zip(servers, threads):
            server.shutdown()
            thread.join(timeout=5)
        for server in servers:
            server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
