#!/usr/bin/env node
/**
 * WPipe Studio - Cryptographic Keypair Generator (Ed25519)
 * Generates an Ed25519 asymmetric keypair for Cloudflare Worker signing and local daemon verification.
 * Author: William Rodriguez (wisrovi.dev)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateEd25519Keys() {
  console.log('Generating Ed25519 Asymmetric Keypair for WPipe Licensing...');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

  const privateKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });

  // Extract raw 32-byte public key (last 32 bytes of 44-byte SPKI)
  const rawPublicKey = publicKeyDer.subarray(publicKeyDer.length - 32);

  const privBase64 = privateKeyDer.toString('base64');
  const pubBase64 = publicKeyDer.toString('base64');
  const pubHex = rawPublicKey.toString('hex');

  const keysData = {
    algorithm: 'Ed25519',
    created_at: new Date().toISOString(),
    private_key_pkcs8_base64: privBase64,
    public_key_spki_base64: pubBase64,
    public_key_raw_hex: pubHex,
    instructions: {
      cloudflare_secret_command: `npx wrangler secret put LICENSE_PRIVATE_KEY`,
      daemon_embedded_public_key: pubHex
    }
  };

  const outputPath = path.join(__dirname, '..', 'keys.json');
  fs.writeFileSync(outputPath, JSON.stringify(keysData, null, 2), { mode: 0o600 });

  console.log('✅ Keys generated successfully!');
  console.log(`📁 Saved to: ${outputPath} (Protected 0600)`);
  console.log('\n--- CLOUDFLARE WORKER CONFIGURATION ---');
  console.log('Run the following command to store the private key in Cloudflare Secrets:');
  console.log('  wrangler secret put LICENSE_PRIVATE_KEY');
  console.log('When prompted, paste the following private key:\n');
  console.log(privBase64);
  console.log('\n--- DAEMON PUBLIC KEY ---');
  console.log('Public Key (Raw Hex, 32 bytes) to embed in daemon_os:');
  console.log(pubHex);
  console.log('--------------------------------------\n');
}

generateEd25519Keys();
