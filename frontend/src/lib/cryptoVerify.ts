/**
 * WPipe Studio - Client-Side Ed25519 Cryptographic License Verification
 * Uses native browser WebCrypto API (window.crypto.subtle)
 * Author: William Rodriguez (wisrovi.dev)
 */

export const DEFAULT_WISROVI_PUBLIC_KEY_HEX =
  "470531dc5170a830ff8028efa9e400b3717965404a28626ffa9cdbe3404e9ed1";

export interface VerifiedLicensePayload {
  sub: string;        // License ID
  lic: string;        // License Key (WPIPE-PRO-XXXX)
  plan: string;       // 'pro' | 'team' | 'enterprise'
  mfp: string;        // Machine Fingerprint
  iat: number;        // Issued At (seconds)
  exp: number;        // Expires At (seconds)
  iss: string;        // Issuer
  grace_days?: number;
}

export interface VerificationResult {
  valid: boolean;
  tier: "free" | "pro" | "team" | "enterprise";
  customerName?: string;
  payload?: VerifiedLicensePayload;
  error?: string;
}

function hexToUint8Array(hex: string): Uint8Array {
  const cleanHex = hex.trim().toLowerCase();
  const match = cleanHex.match(/.{1,2}/g);
  if (!match) return new Uint8Array();
  return new Uint8Array(match.map((byte) => parseInt(byte, 16)));
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Verify compact Ed25519 JWS token (header.payload.signature)
 */
export async function verifyEd25519Token(
  token: string,
  publicKeyHex: string = DEFAULT_WISROVI_PUBLIC_KEY_HEX
): Promise<VerificationResult> {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return {
      valid: false,
      tier: "free",
      error: "Token malformado o vacío",
    };
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return {
      valid: false,
      tier: "free",
      error: "Formato de token inválido (esperado header.payload.signature)",
    };
  }

  const [headerB64, payloadB64, sigB64] = parts;

  try {
    const rawKey = hexToUint8Array(publicKeyHex);
    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      rawKey as unknown as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"]
    );

    const encoder = new TextEncoder();
    const dataBytes = encoder.encode(`${headerB64}.${payloadB64}`);
    const sigBytes = base64UrlDecode(sigB64);

    const isValid = await window.crypto.subtle.verify(
      { name: "Ed25519" },
      cryptoKey,
      sigBytes as unknown as BufferSource,
      dataBytes as unknown as BufferSource
    );

    if (!isValid) {
      return {
        valid: false,
        tier: "free",
        error: "Firma criptográfica inválida (Token alterado o no emitido por Wisrovi)",
      };
    }

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const payload = JSON.parse(payloadJson) as VerifiedLicensePayload;

    // Check expiration timestamp
    const nowSeconds = Date.now() / 1000;
    if (payload.exp && nowSeconds > payload.exp) {
      return {
        valid: false,
        tier: "free",
        payload,
        error: `El pase flotante expiró el ${new Date(payload.exp * 1000).toLocaleString()}`,
      };
    }

    const plan = (payload.plan || "pro").toLowerCase() as "pro" | "team" | "enterprise";
    return {
      valid: true,
      tier: plan,
      payload,
    };
  } catch (err: any) {
    return {
      valid: false,
      tier: "free",
      error: err?.message || "Fallo en la verificación criptográfica WebCrypto",
    };
  }
}
