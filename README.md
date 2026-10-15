# Steg Studio Web

**Live website:** [steg-studio-web.vercel.app](https://steg-studio-web.vercel.app)

A browser-only image steganography workspace for Shishir Khanal. Encrypt text, files, or audio and hide them inside a PNG, then recover the content using its passphrase. Images and passphrases are processed on the device: no application backend, uploads, analytics, or cloud storage.

## Run and build

Requires Node.js 22 or newer. No third-party dependencies are needed.

    npm install
    npm run dev

Open http://127.0.0.1:4173. Encryption requires HTTPS or localhost.

    npm test
    npm run build

The build copies the five browser assets to `dist/`. Vercel reads `vercel.json` and uses framework Other, build command `npm run build`, and output directory `dist`.

## Use

1. Choose Hide data and select an image, or try the sample canvas.
2. Type a message or choose a file/audio clip, then enter a passphrase of at least 8 characters.
3. Download the encrypted PNG. Share it as an original file and share its passphrase separately.
4. In Reveal data, select the original PNG and enter the passphrase to recover the payload.

Supports responsive desktop/mobile layouts, image previews, exact capacity estimates, local session history, and light/dark appearance. Audio is selected from a file; microphone recording is not included. Files/audio can be up to 4 MB; all payloads must also fit the image capacity. Images can be up to 25 MB and 16 megapixels. Transparent covers are flattened onto white so browser premultiplication cannot alter hidden bits.

Do not resize, edit, recompress, or convert exported images to JPEG. Messenger photo compression can erase the payload. Forgotten passphrases cannot be recovered. History stores only operation type, time, and success in memory and clears when the page closes.

## Logic and algorithms

The application combines two techniques: **encryption** protects the contents, and **LSB steganography** places the encrypted bytes inside image pixels. The JavaScript implementation runs in the browser. The optional [Python implementation](python_codec.py) uses the same STGWEB01 format, so either implementation can recover images created by the other.

### Encoding: hide data

1. **Read the cover.** Decode the image into pixels and flatten transparency onto white. Work with RGB channels and leave alpha out of the bit stream.
2. **Prepare the payload.** Encode text as UTF-8, or read file/audio bytes unchanged. Create JSON metadata containing payload type, filename, and MIME type.
3. **Build the inner message.** Join a 4-byte metadata length, UTF-8 metadata, and payload bytes.
4. **Derive a key.** Generate a random 16-byte salt. PBKDF2-HMAC-SHA256 runs 480,000 iterations on the UTF-8 passphrase to derive a 32-byte AES key.
5. **Encrypt and authenticate.** Generate a fresh 12-byte IV. AES-256-GCM encrypts the inner message and adds a 16-byte authentication tag. Authenticate the public 40-byte header as additional data.
6. **Check capacity.** Reject the operation if the full encrypted envelope cannot fit inside the cover.
7. **Embed bits.** Traverse pixels left to right, top to bottom, visiting R, G, then B. Store each envelope byte most significant bit first, replacing one least significant bit per channel.
8. **Export losslessly.** Save the modified pixels as PNG. Each changed RGB channel differs by at most one from its normalized cover value.

```text
Payload + metadata → PBKDF2-derived key → AES-GCM encryption
                  → authenticated envelope → RGB LSB embedding → PNG
```

### Decoding: reveal data

1. Read the first 40 bytes from the RGB least significant bits.
2. Check the `STGWEB01` marker and validate the ciphertext length against image capacity and format limits before allocating the payload buffer.
3. Extract the full envelope and read its salt and IV.
4. Derive the key from the supplied passphrase using the same PBKDF2 settings.
5. Authenticate and decrypt with AES-GCM. An incorrect passphrase or altered authenticated content causes failure; plaintext is released only after verification.
6. Parse the metadata length and JSON, then return the original text/file/audio bytes.

### LSB substitution, with an example

```python
# Embed one bit in an 8-bit colour channel.
modified_channel = (original_channel & 0b11111110) | secret_bit

# Extract that bit later.
secret_bit = modified_channel & 1
```

For example, storing bit `1` in channel value `202` changes binary `11001010` to `11001011` (203). Storing `0` leaves it at 202. The order of channels and bits must match exactly during extraction.

### Capacity and cost

```text
Image capacity = floor(width × height × 3 / 8) bytes
Envelope size  = 40-byte header + 16-byte tag + 4-byte metadata length
                 + UTF-8 metadata bytes + payload bytes
```

A 1200 × 800 image has 360,000 bytes of envelope capacity. Metadata and the 60 fixed framing bytes reduce the room available for actual content. Capacity depends on image dimensions, not its compressed file size. Image and payload processing take O(P + B) time and memory for P pixels and B payload bytes, plus PBKDF2 key derivation and image codec work. Both implementations process data in memory.

## Encryption and format

The web edition uses **STGWEB01**. It does not decode the upstream or desktop formats. PBKDF2-HMAC-SHA256 (480,000 iterations) derives an AES-256-GCM key from a passphrase and random 16-byte salt. Each encryption uses a random 12-byte IV and 128-bit authentication tag. Metadata and data are encrypted together. The entire 40-byte header is authenticated as additional data.

Envelope: marker (8 bytes), big-endian ciphertext length (4), salt (16), IV (12), ciphertext and tag. Inner payload: big-endian JSON metadata length (4), UTF-8 metadata, raw bytes. Envelope bits are embedded most significant first in RGB least-significant bits, skipping alpha. Capacity is floor(width * height * 3 / 8) bytes; encryption and metadata consume part of that space.

Encryption protects content; this sequential LSB scheme does not guarantee that hidden data is undetectable. The app has correctness tests but has not had an independent security audit.

| Envelope field | Size | Meaning |
| --- | --- | --- |
| Marker | 8 bytes | ASCII `STGWEB01` |
| Ciphertext length | 4 bytes | Unsigned big-endian length, including GCM tag |
| Salt | 16 bytes | Random PBKDF2 salt |
| IV | 12 bytes | Random GCM initialization vector |
| Ciphertext + tag | Variable | Encrypted metadata/content and authentication tag |

The inner message starts with a 4-byte unsigned big-endian metadata length, followed by UTF-8 JSON and the raw payload. Python's `struct.pack(">I", value)` matches JavaScript's default big-endian `DataView.setUint32`. Python JSON uses compact separators and UTF-8, matching the browser's metadata representation for ordinary filenames.

## Python implementation

Python 3.10 or newer is required. Install its optional dependencies:

```sh
python -m pip install -r requirements-python.txt
```

Hide a text message, binary file, or audio file:

```sh
python python_codec.py hide --image cover.png --text "A little secret" --output hidden.png
python python_codec.py hide --image cover.png --file document.pdf --output hidden-file.png
python python_codec.py hide --image cover.png --audio message.wav --output hidden-audio.png
```

The CLI asks for the passphrase privately and confirms it when hiding data. It refuses to overwrite an existing output file. Text supplied through `--text` may remain in shell history; use `--file` for sensitive content that should not appear in command arguments.

Recover text to the terminal, or save any payload to an explicit destination:

```sh
python python_codec.py reveal --image hidden.png
python python_codec.py reveal --image hidden-file.png --output recovered.pdf
python python_codec.py reveal --image hidden-audio.png --output recovered.wav
```

The implementation exposes `derive_key`, `seal`, `unseal`, `capacity`, `embed`, `extract`, `encode_image`, and `decode_image` for use from Python code:

```python
from python_codec import encode_image, decode_image

meta = {"type": "text", "name": "secret-message.txt", "mime": "text/plain;charset=utf-8"}
image = encode_image("cover.png", b"A little secret", "a long private phrase", meta)
image.save("example-hidden.png", format="PNG")
result = decode_image("example-hidden.png", "a long private phrase")
assert result["data"] == b"A little secret"
```

Python is an optional local tool. The Vercel deployment serves the static web app and does not execute Python or need a backend. This Python codec supports STGWEB01; it does not support the separate desktop STGNEW01 format.

### Verify the implementations

```sh
npm test
npm run test:python
```

The second command needs Python and its dependencies. It checks JavaScript-to-Python and Python-to-JavaScript recovery through real PNG files, including text/file/audio payloads, Unicode, authentication failures, capacity limits, and opaque normalization of transparent covers.

## Files

- `index.html`, `styles.css`, `app.js`: browser interface and image handling.
- `steg.js`: browser encryption and pixel codec.
- `python_codec.py`: compatible local Python encryption, LSB codec, and CLI.
- `requirements-python.txt`: optional Python dependencies.
- `python-interop.test.mjs`: cross-language PNG recovery and Python error-path tests.
- `build.mjs`, `serve.mjs`: static build and local preview server.
- `steg.test.mjs`: text/file/audio-byte round trips, Unicode, alpha preservation, wrong passwords, tampering, randomized encryption, capacity and malformed-header rejection.
- `vercel.json`: static deployment and security headers.

Browser verification included PNG encoding/reloading, exact Unicode message recovery, wrong-password rejection, and responsive layout checks.

## Credits

The desktop starting point was [ES-KH2/steg-studio](https://github.com/ES-KH2/steg-studio). This repository contains a new web UI and browser backend built for this workspace. The Python desktop project remains separate.
