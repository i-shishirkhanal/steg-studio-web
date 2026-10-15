"""STGWEB01 encryption and PNG steganography, compatible with steg.js.

Optional local Python CLI; not required by the deployed browser application.
"""
from __future__ import annotations

import argparse
import getpass
import json
import mimetypes
import os
import struct
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from PIL import Image

MAGIC = b"STGWEB01"
HEADER_SIZE = 40
ITERATIONS = 480_000
MAX_PAYLOAD = 4 * 1024 * 1024
MAX_METADATA = 4096
MAX_PIXELS = 16_000_000


def derive_key(password: str, salt: bytes) -> bytes:
    """Derive the same 32-byte key as Web Crypto PBKDF2-SHA256."""
    if not password:
        raise ValueError("Enter a nonempty passphrase.")
    return PBKDF2HMAC(
        algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITERATIONS
    ).derive(password.encode("utf-8"))


def _metadata(meta: dict) -> bytes:
    if meta.get("type") not in ("text", "file", "audio") or not isinstance(meta.get("name"), str):
        raise ValueError("Metadata requires a supported type and a filename.")
    encoded = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_METADATA:
        raise ValueError("Metadata must be 4096 bytes or smaller.")
    return encoded


def envelope_size(data_size: int, meta: dict) -> int:
    return HEADER_SIZE + 16 + 4 + len(_metadata(meta)) + data_size


def seal(data: bytes, password: str, meta: dict) -> bytes:
    """Encrypt metadata and bytes, authenticating the entire public header."""
    if len(data) > MAX_PAYLOAD:
        raise ValueError("Payload must be 4 MiB or smaller.")
    metadata = _metadata(meta)
    inner = struct.pack(">I", len(metadata)) + metadata + data
    salt, iv = os.urandom(16), os.urandom(12)
    header = MAGIC + struct.pack(">I", len(inner) + 16) + salt + iv
    cipher = AESGCM(derive_key(password, salt)).encrypt(iv, inner, header)
    return header + cipher


def _validate_header(header: bytes, available: int) -> int:
    if len(header) != HEADER_SIZE or header[:8] != MAGIC:
        raise ValueError("No STGWEB01 payload found. Use an image created by the web app or this Python codec.")
    size = struct.unpack(">I", header[8:12])[0]
    if size < 20 or size > MAX_PAYLOAD + 8192 or size > available - HEADER_SIZE:
        raise ValueError("Hidden payload length is invalid or incomplete.")
    return size


def unseal(envelope: bytes, password: str) -> dict:
    """Verify GCM authentication before releasing metadata or plaintext."""
    header = envelope[:HEADER_SIZE]
    size = _validate_header(header, len(envelope))
    if len(envelope) != HEADER_SIZE + size:
        raise ValueError("Unexpected trailing envelope bytes.")
    key = derive_key(password, header[12:28])
    try:
        inner = AESGCM(key).decrypt(header[28:40], envelope[HEADER_SIZE:], header)
    except InvalidTag as exc:
        raise ValueError("Could not unlock: wrong passphrase or damaged image.") from exc
    if len(inner) < 4:
        raise ValueError("Hidden payload is damaged.")
    meta_size = struct.unpack(">I", inner[:4])[0]
    if meta_size > MAX_METADATA or meta_size > len(inner) - 4:
        raise ValueError("Hidden metadata length is invalid.")
    try:
        meta = json.loads(inner[4:4 + meta_size].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Hidden metadata is invalid.") from exc
    if not isinstance(meta, dict):
        raise ValueError("Hidden metadata must be an object.")
    _metadata(meta)
    data = inner[4 + meta_size:]
    if len(data) > MAX_PAYLOAD:
        raise ValueError("Recovered payload exceeds 4 MiB.")
    return {"meta": meta, "data": data}


def capacity(image: Image.Image) -> int:
    return image.width * image.height * 3 // 8


def _check_image(image: Image.Image) -> None:
    if image.width * image.height > MAX_PIXELS:
        raise ValueError("Images must contain 16 megapixels or fewer.")


def embed(image: Image.Image, envelope: bytes) -> Image.Image:
    """Flatten the cover on white; embed one bit in each successive RGB LSB."""
    _check_image(image)
    if len(envelope) > capacity(image):
        raise ValueError("Payload exceeds image capacity. Choose a larger image.")
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    rgb = Image.alpha_composite(background, rgba).convert("RGB")
    pixels = bytearray(rgb.tobytes())
    for bit in range(len(envelope) * 8):
        secret_bit = (envelope[bit // 8] >> (7 - bit % 8)) & 1
        pixels[bit] = (pixels[bit] & 254) | secret_bit
    return Image.frombytes("RGB", rgb.size, bytes(pixels))


def _read(pixels: bytes, size: int) -> bytes:
    result = bytearray(size)
    for bit in range(size * 8):
        result[bit // 8] |= (pixels[bit] & 1) << (7 - bit % 8)
    return bytes(result)


def extract(image: Image.Image) -> bytes:
    _check_image(image)
    available = capacity(image)
    if available < HEADER_SIZE:
        raise ValueError("Image is too small for a payload header.")
    pixels = image.convert("RGB").tobytes()
    header = _read(pixels, HEADER_SIZE)
    size = _validate_header(header, available)
    return _read(pixels, HEADER_SIZE + size)


def encode_image(cover: str | Path, data: bytes, password: str, meta: dict) -> Image.Image:
    with Image.open(cover) as image:
        _check_image(image)
        if envelope_size(len(data), meta) > capacity(image):
            raise ValueError("Payload exceeds image capacity. Choose a larger image.")
        return embed(image, seal(data, password, meta))


def decode_image(path: str | Path, password: str) -> dict:
    with Image.open(path) as image:
        return unseal(extract(image), password)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    hide = commands.add_parser("hide", help="Encrypt text/file/audio into a PNG")
    hide.add_argument("--image", required=True, type=Path)
    payload = hide.add_mutually_exclusive_group(required=True)
    payload.add_argument("--text")
    payload.add_argument("--file", type=Path)
    payload.add_argument("--audio", type=Path)
    hide.add_argument("--output", required=True, type=Path)
    reveal = commands.add_parser("reveal", help="Recover a STGWEB01 PNG payload")
    reveal.add_argument("--image", required=True, type=Path)
    reveal.add_argument("--output", type=Path, help="Explicit destination for recovered bytes")
    args = parser.parse_args()
    try:
        password = getpass.getpass("Passphrase: ")
        if args.command == "hide":
            if len(password) < 8:
                raise ValueError("Use at least 8 passphrase characters.")
            if password != getpass.getpass("Confirm passphrase: "):
                raise ValueError("Passphrases do not match.")
            if args.output.suffix.lower() != ".png":
                raise ValueError("Output must use the .png extension.")
            if args.text is not None:
                data = args.text.encode("utf-8")
                meta = {"type": "text", "name": "secret-message.txt", "mime": "text/plain;charset=utf-8"}
            else:
                source = args.audio if args.audio is not None else args.file
                if source.stat().st_size > MAX_PAYLOAD:
                    raise ValueError("Payload must be 4 MiB or smaller.")
                data = source.read_bytes()
                meta = {"type": "audio" if args.audio else "file", "name": source.name,
                        "mime": mimetypes.guess_type(source.name)[0] or "application/octet-stream"}
            image = encode_image(args.image, data, password, meta)
            # Exclusive creation prevents accidental cover/payload overwrites.
            with args.output.open("xb") as output:
                image.save(output, format="PNG")
            print(f"Created {args.output}")
        else:
            result = decode_image(args.image, password)
            if args.output:
                with args.output.open("xb") as output:
                    output.write(result["data"])
                print(f"Recovered {len(result['data'])} bytes to {args.output}")
            elif result["meta"]["type"] == "text":
                print(result["data"].decode("utf-8"))
            else:
                raise ValueError("Use --output to choose where to save recovered file/audio bytes.")
    except (ValueError, OSError) as exc:
        parser.exit(1, f"Error: {exc}\n")


if __name__ == "__main__":
    main()
