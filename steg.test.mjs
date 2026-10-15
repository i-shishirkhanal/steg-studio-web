import test from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, embed, extract, capacity, envelopeSize, HEADER_SIZE } from './steg.js';

const pixels = () => new Uint8ClampedArray(128 * 128 * 4).fill(255);
const password = 'a long private passphrase';
for (const type of ['text', 'file', 'audio']) {
  test(`${type} survives encrypted RGB embedding without modifying alpha`, async () => {
    const meta = { type, name: type === 'text' ? 'secret.txt' : 'payload.bin', mime: 'application/octet-stream' };
    const data = type === 'text' ? new TextEncoder().encode('Hello नमस्ते 🔒') : Uint8Array.from({ length: 256 }, (_, i) => i);
    const envelope = await seal(data, password, meta);
    assert.equal(envelope.length, envelopeSize(data.length, meta));
    const original = pixels(); const encoded = embed(original, envelope);
    const result = await unseal(extract(encoded), password);
    assert.deepEqual(result.meta, meta); assert.deepEqual(result.data, data);
    assert.ok(original.every(value => value === 255));
    for (let index = 0; index < encoded.length; index++) {
      if (index % 4 === 3) assert.equal(encoded[index], 255);
      else assert.ok(Math.abs(original[index] - encoded[index]) <= 1);
    }
  });
}
test('wrong passphrase and ciphertext tampering are rejected', async () => {
  const envelope = await seal(new TextEncoder().encode('private'), password, { type: 'text', name: 'secret.txt' });
  await assert.rejects(unseal(envelope, 'wrong passphrase'), /Could not unlock/);
  const changed = envelope.slice(); changed[changed.length - 1] ^= 1;
  await assert.rejects(unseal(changed, password), /Could not unlock/);
  const headerChanged = envelope.slice(); headerChanged[12] ^= 1;
  await assert.rejects(unseal(headerChanged, password), /Could not unlock/);
});
test('random salt and IV make repeated encryption different', async () => {
  const meta = { type: 'file', name: 'file' }; const data = new Uint8Array([1, 2, 3]);
  assert.notDeepEqual(await seal(data, password, meta), await seal(data, password, meta));
});
test('images with no payload, impossible headers, and capacity overflow fail clearly', () => {
  assert.throws(() => extract(pixels()), /No Steg Studio web payload/);
  assert.throws(() => extract(new Uint8Array(16)), /too small/);
  assert.throws(() => embed(pixels(), new Uint8Array(capacity(pixels()) + 1)), /too large/);
  const header = new Uint8Array(HEADER_SIZE); header.set(new TextEncoder().encode('STGWEB01'));
  new DataView(header.buffer).setUint32(8, 0xffffffff);
  assert.throws(() => extract(embed(pixels(), header)), /damaged or incomplete/);
});
test('exact image capacity can be embedded and recovered', () => {
  const image = pixels(); const bytes = new Uint8Array(capacity(image));
  bytes.set(new TextEncoder().encode('STGWEB01'));
  new DataView(bytes.buffer).setUint32(8, bytes.length - HEADER_SIZE);
  assert.deepEqual(extract(embed(image, bytes)), bytes);
});
test('empty passwords and oversized payloads are rejected', async () => {
  await assert.rejects(seal(new Uint8Array(1), '', {}), /passphrase/);
  await assert.rejects(seal(new Uint8Array(4 * 1024 * 1024 + 1), password, {}), /4 MB/);
});
