"""Password hashing and end-to-end message encryption using PyNaCl.

Private keys belong on user devices and should never be sent to or stored by the server.
"""

import base64

from nacl import exceptions
from nacl.pwhash import argon2id
from nacl.public import Box, PrivateKey, PublicKey


def generate_box_keypair() -> tuple[bytes, bytes]:
    """Generate a NaCl Box keypair locally; keep the private key on the user's device."""
    private_key = PrivateKey.generate()
    return bytes(private_key), bytes(private_key.public_key)


def hash_password(password: str) -> str:
    """Hash a password with Argon2id for database storage."""
    return argon2id.str(password.encode("utf-8")).decode("ascii")


def verify_password(password: str, encoded_hash: str) -> bool:
    """Verify an Argon2id hash, returning False for malformed hashes."""
    try:
        return argon2id.verify(encoded_hash.encode("ascii"), password.encode("utf-8"))
    except (exceptions.InvalidkeyError, UnicodeEncodeError, ValueError):
        return False


def encrypt_for_recipient(
    plaintext: str, sender_private_key: bytes, recipient_public_key: bytes
) -> bytes:
    box = Box(PrivateKey(sender_private_key), PublicKey(recipient_public_key))
    encrypted = box.encrypt(plaintext.encode("utf-8"))
    return bytes(encrypted)


def decrypt_from_sender(
    encrypted_payload: bytes, sender_public_key: bytes, recipient_private_key: bytes
) -> str:
    box = Box(PrivateKey(recipient_private_key), PublicKey(sender_public_key))
    return box.decrypt(encrypted_payload).decode("utf-8")


def encode_payload(encrypted_payload: bytes) -> str:
    return base64.urlsafe_b64encode(encrypted_payload).decode("ascii")


def decode_payload(encoded_payload: str) -> bytes:
    return base64.b64decode(encoded_payload, altchars=b"-_", validate=True)
