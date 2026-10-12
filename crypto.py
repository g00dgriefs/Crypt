"""Password hashing and end-to-end message encryption using libsodium via PyNaCl.

Message encryption uses each sender's private key and the recipient's public key.
Keep private keys on user devices; do not send them to or store them on the server.
"""

import base64

from nacl import exceptions
from nacl.pwhash import argon2id
from nacl.public import Box, PrivateKey, PublicKey


def hash_password(password: str) -> str:
    """Return an Argon2id hash suitable for storing in the users table."""
    return argon2id.str(password.encode("utf-8")).decode("ascii")


def verify_password(password: str, encoded_hash: str) -> bool:
    """Verify a password hash without raising on an invalid or malformed hash."""
    try:
        return argon2id.verify(encoded_hash.encode("ascii"), password.encode("utf-8"))
    except (exceptions.InvalidkeyError, UnicodeEncodeError, ValueError):
        return False


def encrypt_for_recipient(
    plaintext: str, sender_private_key: bytes, recipient_public_key: bytes
) -> bytes:
    """Encrypt text for a recipient; the returned bytes include the random nonce."""
    box = Box(PrivateKey(sender_private_key), PublicKey(recipient_public_key))
    encrypted = box.encrypt(plaintext.encode("utf-8"))
    return bytes(encrypted)


def decrypt_from_sender(
    encrypted_payload: bytes, sender_public_key: bytes, recipient_private_key: bytes
) -> str:
    """Decrypt a stored Box payload using the recipient's private key."""
    box = Box(PrivateKey(recipient_private_key), PublicKey(sender_public_key))
    return box.decrypt(encrypted_payload).decode("utf-8")


def encode_payload(encrypted_payload: bytes) -> str:
    """Encode encrypted bytes for transport in JSON."""
    return base64.urlsafe_b64encode(encrypted_payload).decode("ascii")


def decode_payload(encoded_payload: str) -> bytes:
    """Decode a JSON-safe encrypted payload."""
    return base64.b64decode(encoded_payload, altchars=b"-_", validate=True)
