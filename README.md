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

## Encryption and format

The web edition uses **STGWEB01**. It does not decode the upstream or desktop formats. PBKDF2-HMAC-SHA256 (480,000 iterations) derives an AES-256-GCM key from a passphrase and random 16-byte salt. Each encryption uses a random 12-byte IV and 128-bit authentication tag. Metadata and data are encrypted together. The entire 40-byte header is authenticated as additional data.

Envelope: marker (8 bytes), big-endian ciphertext length (4), salt (16), IV (12), ciphertext and tag. Inner payload: big-endian JSON metadata length (4), UTF-8 metadata, raw bytes. Envelope bits are embedded most significant first in RGB least-significant bits, skipping alpha. Capacity is floor(width * height * 3 / 8) bytes; encryption and metadata consume part of that space.

Encryption protects content; this sequential LSB scheme does not guarantee that hidden data is undetectable. The app has correctness tests but has not had an independent security audit.

## Files

- `index.html`, `styles.css`, `app.js`: browser interface and image handling.
- `steg.js`: browser encryption and pixel codec.
- `build.mjs`, `serve.mjs`: static build and local preview server.
- `steg.test.mjs`: text/file/audio-byte round trips, Unicode, alpha preservation, wrong passwords, tampering, randomized encryption, capacity and malformed-header rejection.
- `vercel.json`: static deployment and security headers.

Browser verification included PNG encoding/reloading, exact Unicode message recovery, wrong-password rejection, and responsive layout checks.

## Credits

The desktop starting point was [ES-KH2/steg-studio](https://github.com/ES-KH2/steg-studio). This repository contains a new web UI and browser backend built for this workspace. The Python desktop project remains separate.
