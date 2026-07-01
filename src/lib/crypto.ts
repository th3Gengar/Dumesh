/**
 * Client-Side Hybrid E2E Encryption using Web Crypto API.
 * Safely handles:
 *  - User RSA-OAEP Asymmetric KeyPairs (2048-bit)
 *  - Room-specific or Direct AES-GCM Symmetric Keys (256-bit)
 */

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generate a client-side asymmetric keypair
 */
export async function generateAsymmetricKeyPair(): Promise<{
  publicKeyJwk: string;
  privateKeyJwk: string;
}> {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );

  const exportedPublicKey = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const exportedPrivateKey = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);

  return {
    publicKeyJwk: JSON.stringify(exportedPublicKey),
    privateKeyJwk: JSON.stringify(exportedPrivateKey),
  };
}

/**
 * Encrypt bytes using a recipient's public key (RSA-OAEP)
 */
export async function asymmetricallyEncrypt(
  publicKeyJwkStr: string,
  rawSymmetricKey: ArrayBuffer
): Promise<string> {
  const jwk = JSON.parse(publicKeyJwkStr);
  const cryptoPublicKey = await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    cryptoPublicKey,
    rawSymmetricKey
  );

  return arrayBufferToBase64(encryptedBuffer);
}

/**
 * Decrypt bytes using a client's private key (RSA-OAEP)
 */
export async function asymmetricallyDecrypt(
  privateKeyJwkStr: string,
  encryptedBase64: string
): Promise<ArrayBuffer> {
  const jwk = JSON.parse(privateKeyJwkStr);
  const cryptoPrivateKey = await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );

  const encryptedBuffer = base64ToArrayBuffer(encryptedBase64);
  return await window.crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    cryptoPrivateKey,
    encryptedBuffer
  );
}

/**
 * Generate of an AES-GCM 256-bit symmetric session key
 */
export async function generateSymmetricKey(): Promise<ArrayBuffer> {
  const key = await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );
  return await window.crypto.subtle.exportKey("raw", key);
}

/**
 * Symmetrically encrypt a string message using AES-GCM
 */
export async function symmetricallyEncrypt(
  plainText: string,
  aesRawKey: ArrayBuffer
): Promise<string> {
  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    aesRawKey,
    "AES-GCM",
    true,
    ["encrypt"]
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 12-byte IV for GCM
  const encoder = new TextEncoder();
  const data = encoder.encode(plainText);

  const cipherBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    cryptoKey,
    data
  );

  const ivBase64 = arrayBufferToBase64(iv.buffer);
  const cipherBase64 = arrayBufferToBase64(cipherBuffer);

  // Return composite format "iv:ciphertext"
  return `${ivBase64}:${cipherBase64}`;
}

/**
 * Symmetrically decrypt a message using AES-GCM
 */
export async function symmetricallyDecrypt(
  ivCipherComposite: string,
  aesRawKey: ArrayBuffer
): Promise<string> {
  const [ivBase64, cipherBase64] = ivCipherComposite.split(":");
  if (!ivBase64 || !cipherBase64) {
    throw new Error("Invalid encrypted format. Expected iv:ciphertext.");
  }

  const cryptoKey = await window.crypto.subtle.importKey(
    "raw",
    aesRawKey,
    "AES-GCM",
    true,
    ["decrypt"]
  );

  const iv = new Uint8Array(base64ToArrayBuffer(ivBase64));
  const cipher = base64ToArrayBuffer(cipherBase64);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    cryptoKey,
    cipher
  );

  const decoder = new TextDecoder();
  return decoder.decode(decryptedBuffer);
}
