import test from 'node:test';
import assert from 'node:assert/strict';
import {Reader, coins, address, serializedOutput, varint, compact, block, hash256} from '../scripts/chainstate.mjs';

const gx = Buffer.from('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex');
const gy = Buffer.from('483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8', 'hex');
const prime = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const negativeY = Buffer.from((prime - BigInt('0x' + gy.toString('hex'))).toString(16).padStart(64, '0'), 'hex');
const record = script => Buffer.concat([varint(1), varint(2), varint(1), script, varint(5)]);

test('large valid amounts retain every base unit beyond Number-safe compressed integers', () => {
  // 11,462,486.99999999 ZCL compresses to 10,316,238,299,999,991, above 2^53.
  const compressed = Buffer.from('91a8d185b9a7dc77', 'hex');
  assert.equal(new Reader(compressed).varbig(), 10316238299999991n);
  assert.throws(() => new Reader(compressed).varint(), /overflow/);
  const data = Buffer.concat([varint(1), varint(2), compressed, varint(7), Buffer.from([0x51]), varint(5)]);
  assert.equal(coins(data).outputs[0].value, 1146248699999999n);
});

test('CompactSize rejects noncanonical lengths exactly as the release reader does', () => {
  for (const [encoded, expected] of [['fc', 252], ['fdfd00', 253], ['fe00000100', 65536], ['ff0000000001000000', 4294967296]]) {
    assert.equal(new Reader(Buffer.from(encoded, 'hex')).compact(), expected);
  }
  for (const encoded of ['fd0100', 'feffff0000', 'ffffffffff00000000']) {
    assert.throws(() => new Reader(Buffer.from(encoded, 'hex')).compact(), /Noncanonical/);
  }
});

test('decompresses both public-key parities and preserves compressed versus uncompressed scripts', () => {
  for (const type of [2, 3, 4, 5]) {
    const output = coins(record(Buffer.concat([varint(type), gx]))).outputs[0];
    const publicKey = type < 4 ? Buffer.concat([Buffer.from([type]), gx]) : Buffer.concat([Buffer.from([4]), gx, type === 4 ? gy : negativeY]);
    assert.deepEqual(output.script, Buffer.concat([Buffer.from([publicKey.length]), publicKey, Buffer.from([0xac])]));
    assert.equal(output.value, 1n);
  }
  const compressed = coins(record(Buffer.concat([varint(2), gx]))).outputs[0];
  const p2pkh = Buffer.from('76a914751e76e8199196d454941c45d1b3a323f1433bd688ac', 'hex');
  assert.equal(address(compressed.script), address(p2pkh));
  const uncompressed = coins(record(Buffer.concat([varint(4), gx]))).outputs[0];
  assert.notEqual(address(compressed.script), address(uncompressed.script));
});

test('zero mask bytes preserve exact sparse output indexes and raw scripts', () => {
  const data = Buffer.concat([varint(1), varint(0), Buffer.from([0, 1]), varint(0), varint(7), Buffer.from([0x51]), varint(25)]);
  const parsed = coins(data);
  assert.deepEqual(parsed.outputs, [{index: 10, value: 0n, script: Buffer.from([0x51])}]);
  assert.equal(parsed.height, 25);
  assert.equal(address(parsed.outputs[0].script), null);
  assert.equal(coins(record(varint(6))).outputs[0].script.length, 0);
});

test('malformed public-key pushes remain unattributed instead of receiving synthetic addresses', () => {
  const valid = Buffer.concat([Buffer.from([33, 2]), gx, Buffer.from([0xac])]);
  assert.ok(address(valid));
  const wrongPrefix = Buffer.from(valid); wrongPrefix[1] = 0;
  assert.equal(address(wrongPrefix), null);
  assert.equal(address(Buffer.concat([Buffer.from([33, 2]), Buffer.alloc(32, 0xff), Buffer.from([0xac])])), null);
  assert.equal(address(Buffer.concat([Buffer.from([65, 4]), Buffer.alloc(64), Buffer.from([0xac])])), null);
});

test('output commitment serialization uses base units, signed little endian and CompactSize scripts', () => {
  const small = serializedOutput({index: 0, value: 100000000n, script: Buffer.from([0x51])});
  assert.equal(small.toString('hex'), '0100e1f505000000000151');
  const script = Buffer.alloc(253, 0x51);
  const large = serializedOutput({index: 127, value: 2100000000000000n, script});
  assert.equal(large.subarray(0, 2).toString('hex'), '8000');
  assert.equal(large.readBigInt64LE(2), 2100000000000000n);
  assert.equal(large.subarray(10, 13).toString('hex'), 'fdfd00');
  assert.deepEqual(large.subarray(13), script);
});

test('disk-index flags and shielded accounting tails do not alter extracted header identity', () => {
  const header = Buffer.alloc(140);
  header.writeInt32LE(4);
  Buffer.alloc(32, 0x12).copy(header, 4);
  header.writeUInt32LE(1700000000, 100);
  const solution = Buffer.concat([compact(1344), Buffer.alloc(1344, 0x47)]);
  const expected = hash256(Buffer.concat([header, solution]));
  for (const status of [0, 8, 16, 8 | 16, 128, 8 | 16 | 128]) {
    const metadata = [varint(2100000), varint(123), varint(status), varint(1)];
    if (status & 24) metadata.push(varint(7));
    if (status & 8) metadata.push(varint(70000));
    if (status & 16) metadata.push(varint(999));
    if (status & 128) metadata.push(Buffer.alloc(4, 0x34));
    metadata.push(Buffer.alloc(32, 0x56));
    // Newer disk versions append optional Sprout value plus Sapling value.
    const parsed = block(Buffer.concat([...metadata, header, solution, Buffer.alloc(9)]));
    assert.equal(parsed.height, 123);
    assert.equal(parsed.time, 1700000000);
    assert.deepEqual(parsed.prev, Buffer.alloc(32, 0x12));
    assert.deepEqual(parsed.hash, expected);
  }
});
