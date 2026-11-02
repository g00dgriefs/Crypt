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

/** Generate or unlock this account's keypair, keeping only the encrypted
 * private key in this browser's local storage. The server receives only the
 * public key. The account password is used locally to wrap the private key.
 */
export async function createOrUnlockDeviceKeys(user, password) {
  await sodium.ready;
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Enter your account password to unlock the encryption key.");
  }

  const savedValue = localStorage.getItem(storageName(user.id));
  let keypair;
  let publicKeyEncoded;

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

  if (!user.public_key) {
    const response = await fetch("/api/public-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ public_key: publicKeyEncoded }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Could not save the public key.");
  }

  return keypair;
}

export async function encryptText(plaintext, recipientPublicKey, senderPrivateKey) {
  await sodium.ready;
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const ciphertext = sodium.crypto_box_easy(
    sodium.from_string(plaintext),
    nonce,
    fromBase64(recipientPublicKey),
    senderPrivateKey
  );
  const payload = new Uint8Array(nonce.length + ciphertext.length);
  payload.set(nonce);
  payload.set(ciphertext, nonce.length);
  return toBase64(payload);
}

export async function decryptText(encodedPayload, senderPublicKey, recipientPrivateKey) {
  await sodium.ready;
  const payload = fromBase64(encodedPayload);
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
