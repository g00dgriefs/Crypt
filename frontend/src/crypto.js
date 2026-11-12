import sodium from "libsodium-wrappers-sumo";

function toBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function wrappingKey(
  password,
  salt,
  opsLimit = sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
  memLimit = sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE
) {
  return sodium.crypto_pwhash(
    sodium.crypto_secretbox_KEYBYTES,
    password,
    salt,
    opsLimit,
    memLimit,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
}

function storageName(userId) {
  return `crypt-device-key-${userId}`;
}

/** Generate or unlock this account's keypair. The private key is wrapped with
 * the account password and stored locally; only that encrypted bundle and the
 * public key are synced to the server. The password and plaintext private key
 * never leave this browser.
 */
export async function createOrUnlockDeviceKeys(user, password) {
  await sodium.ready;
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Enter your account password to unlock the encryption key.");
  }

  let savedValue = localStorage.getItem(storageName(user.id));
  let restoredFromBackup = false;
  let keypair;
  let publicKeyEncoded;

  if (!savedValue && user.public_key) {
    const response = await fetch("/api/device-key-backup");
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || "This account's device key backup could not be loaded.");
    }
    savedValue = JSON.stringify(body.backup);
    restoredFromBackup = true;
  }

  if (savedValue) {
    const saved = JSON.parse(savedValue);
    publicKeyEncoded = saved.public_key;
    const salt = fromBase64(saved.salt);
    const nonce = fromBase64(saved.nonce);
    const encryptedPrivateKey = fromBase64(saved.encrypted_private_key);
    const key = await wrappingKey(
      password,
      salt,
      saved.opslimit,
      saved.memlimit
    );
    try {
      keypair = {
        publicKey: fromBase64(saved.public_key),
        privateKey: sodium.crypto_secretbox_open_easy(
          encryptedPrivateKey,
          nonce,
          key
        ),
      };
    } catch {
      throw new Error("That password could not unlock this device's encryption key.");
    } finally {
      sodium.memzero(key);
    }
  } else {
    if (user.public_key) {
      throw new Error(
        "This account already has an encryption key, but its private key is not stored on this device."
      );
    }
    const generated = sodium.crypto_box_keypair();
    keypair = { publicKey: generated.publicKey, privateKey: generated.privateKey };
    publicKeyEncoded = toBase64(keypair.publicKey);
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const opslimit = sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE;
    const memlimit = sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE;
    const key = await wrappingKey(password, salt, opslimit, memlimit);
    let encryptedPrivateKey;
    try {
      encryptedPrivateKey = sodium.crypto_secretbox_easy(
        keypair.privateKey,
        nonce,
        key
      );
    } finally {
      sodium.memzero(key);
    }
    localStorage.setItem(storageName(user.id), JSON.stringify({
      version: 1,
      kdf: "argon2id13",
      opslimit,
      memlimit,
      public_key: publicKeyEncoded,
      salt: toBase64(salt),
      nonce: toBase64(nonce),
      encrypted_private_key: toBase64(encryptedPrivateKey),
    }));
  }

  if (keypair.publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES ||
      keypair.privateKey.length !== sodium.crypto_box_SECRETKEYBYTES) {
    throw new Error("The saved encryption key is invalid.");
  }
  if (user.public_key && !sodium.memcmp(
    keypair.publicKey,
    fromBase64(user.public_key)
  )) {
    throw new Error("The encryption key saved on this device does not match this account.");
  }

  if (restoredFromBackup) {
    localStorage.setItem(storageName(user.id), savedValue);
  }

  if (!user.public_key) {
    const response = await fetch("/api/public-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_key: publicKeyEncoded }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not save the public key.");
  }

  const backup = JSON.parse(localStorage.getItem(storageName(user.id)));
  const backupResponse = await fetch("/api/device-key-backup", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backup }),
  });
  const backupResult = await backupResponse.json().catch(() => ({}));
  if (!backupResponse.ok) {
    throw new Error(backupResult.error || "Could not save the encrypted device key backup.");
  }

  return keypair;
}

export async function encryptText(plaintext, recipientPublicKey, senderPrivateKey) {
  await sodium.ready;
  const message = sodium.from_string(plaintext);
  const senderPublicKey = sodium.crypto_scalarmult_base(senderPrivateKey);
  const recipientCopy = encryptBoxPayload(message, recipientPublicKey, senderPrivateKey);
  const senderCopy = encryptBoxPayload(message, toBase64(senderPublicKey), senderPrivateKey);

  // Store two independently encrypted Box payloads: one for the recipient and
  // one for the sender, so both can decrypt after reloading their message list.
  const header = new Uint8Array([67, 82, 89, 80, 84, 1]); // "CRYPT", version 1
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, recipientCopy.length);
  const envelope = new Uint8Array(header.length + length.length + recipientCopy.length + senderCopy.length);
  envelope.set(header, 0);
  envelope.set(length, header.length);
  envelope.set(recipientCopy, header.length + length.length);
  envelope.set(senderCopy, header.length + length.length + recipientCopy.length);
  return toBase64(envelope);
}

function encryptBoxPayload(message, recipientPublicKey, senderPrivateKey) {
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    message,
    nonce,
    fromBase64(recipientPublicKey),
    senderPrivateKey
  );
  const payload = new Uint8Array(nonce.length + ciphertext.length);
  payload.set(nonce);
  payload.set(ciphertext, nonce.length);
  return payload;
}

export async function decryptText(encodedPayload, senderPublicKey, recipientPrivateKey, isSender = false) {
  await sodium.ready;
  let payload = fromBase64(encodedPayload);
  const magic = [67, 82, 89, 80, 84, 1];
  const isEnvelope = magic.every((byte, index) => payload[index] === byte);
  if (isEnvelope) {
    if (payload.length < 10) throw new Error("Encrypted message is incomplete.");
    const recipientLength = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(6);
    const recipientStart = 10;
    const senderStart = recipientStart + recipientLength;
    if (senderStart > payload.length) throw new Error("Encrypted message is incomplete.");
    payload = isSender
      ? payload.subarray(senderStart)
      : payload.subarray(recipientStart, senderStart);
  }
  if (payload.length < sodium.crypto_box_NONCEBYTES + sodium.crypto_box_MACBYTES) {
    throw new Error("Encrypted message is incomplete.");
  }
  const nonce = payload.subarray(0, sodium.crypto_box_NONCEBYTES);
  const ciphertext = payload.subarray(sodium.crypto_box_NONCEBYTES);
  const plaintext = sodium.crypto_box_open_easy(
    ciphertext,
    nonce,
    fromBase64(senderPublicKey),
    recipientPrivateKey
  );
  return sodium.to_string(plaintext);
}

export function encodePublicKey(publicKey) {
  return toBase64(publicKey);
}
