// STGWEB01: marker(8), ciphertext length(4), salt(16), IV(12), ciphertext.
// The complete 40-byte header is authenticated as AES-GCM additional data.
export const MAGIC = new TextEncoder().encode('STGWEB01');
export const HEADER_SIZE = 40;
export const ITERATIONS = 480000;
export const MAX_PAYLOAD = 4 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

async function derive(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function capacity(rgba) { return Math.floor(rgba.length / 4 * 3 / 8); }
export function metadataBytes(meta) { return encoder.encode(JSON.stringify(meta)); }
export function envelopeSize(dataSize, meta) { return HEADER_SIZE + 16 + 4 + metadataBytes(meta).length + dataSize; }

export async function seal(data, password, meta) {
  if (!password) throw new Error('Enter a passphrase to protect your data.');
  if (data.length > MAX_PAYLOAD) throw new Error('Payloads must be 4 MB or smaller.');
  const metadata = metadataBytes(meta);
  if (metadata.length > 4096) throw new Error('The payload filename is too long.');
  const inner = new Uint8Array(4 + metadata.length + data.length);
  new DataView(inner.buffer).setUint32(0, metadata.length);
  inner.set(metadata, 4);
  inner.set(data, 4 + metadata.length);
  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC);
  new DataView(header.buffer).setUint32(8, inner.length + 16);
  header.set(crypto.getRandomValues(new Uint8Array(16)), 12);
  header.set(crypto.getRandomValues(new Uint8Array(12)), 28);
  const key = await derive(password, header.subarray(12, 28));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: header.subarray(28), additionalData: header }, key, inner));
  const result = new Uint8Array(header.length + cipher.length);
  result.set(header); result.set(cipher, header.length);
  return result;
}

export async function unseal(envelope, password) {
  if (!password) throw new Error('Enter the passphrase used to hide this data.');
  const header = envelope.subarray(0, HEADER_SIZE);
  const key = await derive(password, header.subarray(12, 28));
  let inner;
  try {
    inner = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: header.subarray(28), additionalData: header }, key, envelope.subarray(HEADER_SIZE)));
  } catch { throw new Error('Could not unlock this image. Check the passphrase, or try the original, unedited PNG.'); }
  if (inner.length < 4) throw new Error('The hidden payload is damaged.');
  const size = new DataView(inner.buffer).getUint32(0);
  if (size > 4096 || size > inner.length - 4) throw new Error('The hidden metadata is invalid.');
  const meta = JSON.parse(decoder.decode(inner.subarray(4, 4 + size)));
  if (!['text', 'file', 'audio'].includes(meta.type) || typeof meta.name !== 'string') throw new Error('Unsupported payload type.');
  return { meta, data: inner.slice(4 + size) };
}

export function embed(rgba, bytes) {
  if (bytes.length > capacity(rgba)) throw new Error('This payload is too large for the image. Use a larger cover or a smaller payload.');
  const result = rgba.slice();
  for (let bit = 0; bit < bytes.length * 8; bit++) {
    const channel = Math.floor(bit / 3) * 4 + bit % 3;
    result[channel] = (result[channel] & 254) | ((bytes[bit >> 3] >> (7 - (bit & 7))) & 1);
  }
  return result;
}

function read(rgba, size) {
  const bytes = new Uint8Array(size);
  for (let bit = 0; bit < size * 8; bit++) {
    const channel = Math.floor(bit / 3) * 4 + bit % 3;
    bytes[bit >> 3] |= (rgba[channel] & 1) << (7 - (bit & 7));
  }
  return bytes;
}

export function extract(rgba) {
  if (capacity(rgba) < HEADER_SIZE) throw new Error('This image is too small to contain a payload.');
  const header = read(rgba, HEADER_SIZE);
  if (!MAGIC.every((value, index) => header[index] === value)) throw new Error('No Steg Studio web payload found. Choose a PNG created by this web app.');
  const size = new DataView(header.buffer).getUint32(8);
  if (size < 20 || size > MAX_PAYLOAD + 8192 || size > capacity(rgba) - HEADER_SIZE) throw new Error('The hidden payload is damaged or incomplete.');
  return read(rgba, HEADER_SIZE + size);
}
