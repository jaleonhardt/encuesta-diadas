"""Cifrado AES-256-GCM de los datos sensibles (domicilio, geometrías, firmas, audio)."""
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import settings

_aes = AESGCM(settings.data_key)


def encrypt_bytes(data: bytes) -> bytes:
    nonce = os.urandom(12)
    return nonce + _aes.encrypt(nonce, data, None)


def decrypt_bytes(blob: bytes) -> bytes:
    blob = bytes(blob)
    return _aes.decrypt(blob[:12], blob[12:], None)


def encrypt_json(obj: Any) -> bytes:
    return encrypt_bytes(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def decrypt_json(blob: bytes) -> Any:
    return json.loads(decrypt_bytes(blob).decode("utf-8"))
