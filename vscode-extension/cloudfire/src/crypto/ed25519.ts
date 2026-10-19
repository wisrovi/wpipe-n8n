/**
 * Ed25519 Cryptographic Signing & Verification for Cloudflare Workers
 * Author: William Rodriguez (wisrovi.dev)
 */

export interface LeasePayload {
  sub: string;             // License ID
  lic: string;             // License Key (e.g. WPIPE-PRO-XXXX)
  plan: string;            // 'pro' | 'team' | 'enterprise'
  mfp: string;             // Machine Fingerprint
  iat: number;             // Issued At (unix timestamp seconds)
  exp: number;             // Expires At (unix timestamp seconds)
  grace_days: number;      // Grace period in days
  iss: string;             // Issuer (https://api.wisrovi.dev)
}

function base64UrlEncode(data: Uint8Array | string): string {
  let str: string;
  if (typeof data === "string") {
    str = btoa(unescape(encodeURIComponent(data)));
  } else {
    let binary = "";
    for (let i = 0; i < data.byteLength; i++) {
      binary += String.fromCharCode(data[i]);
    }
    str = btoa(binary);
  }
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Imports PKCS#8 private key for Ed25519 signing.
 */
async function importEd25519PrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  const keyBytes = base64ToUint8Array(pkcs8Base64);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      keyBytes,
      { name: "Ed25519" },
      false,
      ["sign"]
    );
  } catch {
    // Fallback for Node.js / older Worker runtimes
    return await crypto.subtle.importKey(
      "pkcs8",
      keyBytes,
      { name: "NODE-ED25519", namedCurve: "NODE-ED25519" } as any,
      false,
      ["sign"]
    );
  }
}

/**
 * Signs a license lease payload using Ed25519, returning a standard compact JWS token:
 * header.payload.signature
 */
export async function signLeaseToken(
  payload: LeasePayload,
  privateKeyPkcs8Base64: string
): Promise<string> {
  const header = {
    alg: "EdDSA",
    typ: "JWT",
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const messageString = `${encodedHeader}.${encodedPayload}`;
  const messageBytes = new TextEncoder().encode(messageString);

  const privateKey = await importEd25519PrivateKey(privateKeyPkcs8Base64);
  const signatureBuffer = await crypto.subtle.sign(
    { name: "Ed25519" },
    privateKey,
    messageBytes
  );

  const signatureBytes = new Uint8Array(signatureBuffer);
  const encodedSignature = base64UrlEncode(signatureBytes);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}
