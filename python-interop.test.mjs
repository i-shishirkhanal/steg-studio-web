import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { seal, unseal, embed, extract } from './steg.js';

const password = 'a private test phrase नमस्ते';
function python(script, input = {}) {
  const result = spawnSync(process.env.PYTHON || 'python', ['-c', script], {
    input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}
const preamble = `
import base64, json, sys, tempfile
from pathlib import Path
from PIL import Image
import python_codec as codec
args = json.load(sys.stdin)
`;

for (const type of ['text', 'file', 'audio']) {
  test(`JavaScript → PNG → Python recovers ${type}`, async () => {
    const data = type === 'text' ? new TextEncoder().encode('Hello नमस्ते 🔒') : Uint8Array.from({ length: 256 }, (_, i) => i);
    const meta = { type, name: type === 'text' ? '秘密.txt' : 'payload.bin', mime: 'application/octet-stream' };
    const rgba = new Uint8ClampedArray(128 * 128 * 4).fill(255);
    const encoded = embed(rgba, await seal(data, password, meta));
    const result = python(preamble + `
with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / 'browser.png'
    Image.frombytes('RGBA', (128,128), base64.b64decode(args['rgba'])).save(path)
    result = codec.decode_image(path, args['password'])
    print(json.dumps({'meta':result['meta'], 'data':base64.b64encode(result['data']).decode()}))
`, { rgba: Buffer.from(encoded).toString('base64'), password });
    assert.deepEqual(result.meta, meta);
    assert.deepEqual(Buffer.from(result.data, 'base64'), Buffer.from(data));
  });

  test(`Python → PNG → JavaScript recovers ${type}`, async () => {
    const data = type === 'text' ? new TextEncoder().encode('Python secret: नमस्ते 🌿') : Uint8Array.from({ length: 256 }, (_, i) => 255 - i);
    const meta = { type, name: '秘密-' + type + '.bin', mime: 'application/octet-stream' };
    const result = python(preamble + `
with tempfile.TemporaryDirectory() as folder:
    cover = Path(folder) / 'cover.png'
    output = Path(folder) / 'python.png'
    Image.new('RGBA', (128,128), (90,120,160,70)).save(cover)
    encoded = codec.encode_image(cover, base64.b64decode(args['data']), args['password'], args['meta'])
    encoded.save(output, format='PNG')
    with Image.open(output) as image:
        rgba = image.convert('RGBA').tobytes()
    print(json.dumps({'rgba':base64.b64encode(rgba).decode()}))
`, { data: Buffer.from(data).toString('base64'), meta, password });
    const rgba = new Uint8ClampedArray(Buffer.from(result.rgba, 'base64'));
    for (let index = 3; index < rgba.length; index += 4) assert.equal(rgba[index], 255);
    const recovered = await unseal(extract(rgba), password);
    assert.deepEqual(recovered.meta, meta);
    assert.deepEqual(recovered.data, data);
  });
}

test('Python rejects wrong passwords, damaged headers/tags, overflow, invalid metadata, and unknown images', () => {
  const result = python(preamble + `
def rejected(action):
    try:
        action()
    except ValueError:
        return True
    return False
meta = {'type':'text', 'name':'secret.txt'}
envelope = codec.seal(b'private', 'test phrase', meta)
checks = []
checks.append(rejected(lambda: codec.unseal(envelope, 'wrong')))
damaged = bytearray(envelope); damaged[-1] ^= 1
checks.append(rejected(lambda: codec.unseal(bytes(damaged), 'test phrase')))
header = bytearray(envelope); header[12] ^= 1
checks.append(rejected(lambda: codec.unseal(bytes(header), 'test phrase')))
checks.append(rejected(lambda: codec.embed(Image.new('RGB',(1,1)), envelope)))
checks.append(rejected(lambda: codec.extract(Image.new('RGB',(128,128)))))
checks.append(rejected(lambda: codec.seal(b'x', '', meta)))
checks.append(rejected(lambda: codec.seal(b'x' * (codec.MAX_PAYLOAD+1), 'test', meta)))
checks.append(rejected(lambda: codec.seal(b'x', 'test', {'type':'unknown','name':'x'})))
print(json.dumps(checks))
`);
  assert.deepEqual(result, Array(8).fill(true));
});
