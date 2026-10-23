# WPipe Studio — VS Code Extension, Native Engine & Cloudflare Licensing

Complete suite for visual WPipe pipeline engineering and production Python microservice generation natively integrated into **Visual Studio Code**, operating under a **local-first** architecture with **0 €/month** server costs and commercial copy protection.

- **Lead Architect**: William Rodriguez (AI Leader & Solutions Architect — [wisrovi.dev](https://wisrovi.dev))  
- **Ecosystem**: WPipe OS / wisrovi SUITE  
- **Licensing Model**: Freemium (≤ 5 blocks Free / Unlimited Pro with Ed25519 cryptographic tokens)

---

## 🛠️ Core Technologies and Relevant Libraries

| Component | Key Technologies & Libraries |
|---|---|
| **`cloudfire/`** | **Cloudflare Workers** (edge licensing gateway), **Cloudflare D1** (serverless SQLite), **Cloudflare R2** (zero-egress object storage), **WebCrypto API Ed25519** (asymmetric signatures), **TypeScript**, **Wrangler CLI**. |
| **`daemon_os/`** | **Python 3.11+ / CPython**, **PyCA Cryptography** (Ed25519 cryptographic signature verification), **Unix Domain Sockets** (`socket.AF_UNIX`), **Localhost HTTP / W3C PNA** (`127.0.0.1:49152`), **Nuitka / PyInstaller** (AOT compilation to closed binary), **Pytest** (unit and penetration security test suite). |
| **`extension/`** | **VS Code Extensibility API** (`CustomTextEditorProvider` for `*.wpipe`), **TypeScript 5**, **VS Code Webview API** (isolated React + Blockly canvas), **Node.js HTTP/IPC**. |
| **`portal-cloudfire/`** | **React 18**, **Vite**, **TypeScript**, **Tailwind CSS**, **Lucide React**, **Cloudflare Pages** (enterprise client self-service portal). |
| **`admin-web/`** | **React 18**, **Vite**, **TypeScript**, **Tailwind CSS**, **Lucide React**, **Cloudflare Pages** (super-administrative master console). |

---

## 📁 Ecosystem Structure

```
vscode-extension/
├── cloudfire/                 # Serverless Licensing Server (Cloudflare Edge)
│   ├── wrangler.toml          # D1 and R2 bindings configuration
│   ├── schema.sql             # Cloudflare D1 schema: licenses, activations, audit_logs
│   ├── keys.json              # Ed25519 asymmetric cryptographic keypair
│   ├── src/                   # HTTP routing, Ed25519 signatures, activations and webhooks
│   └── scripts/deploy.sh      # Cloudflare deployment script (api.wisrovi.dev)
│
├── daemon_os/                 # Local native system engine (wpipe-engine)
│   ├── wpipe_engine/          # Core daemon: licensing, freemium enforcer, AST compiler, IPC
│   ├── build.sh               # Closed native binary compiler
│   ├── package/               # OS packaging: systemd, snapcraft.yaml
│   └── tests/                 # Comprehensive unit and penetration test suite (pytest)
│
├── extension/                 # Visual Studio Code extension
│   ├── package.json           # VS Code extension manifest, commands, *.wpipe custom editor
│   ├── src/                   # Extension lifecycle, daemon manager, IPC client, and Webview
│   └── dist/                  # Compiled TypeScript bundle ready for VSIX packaging
│
├── portal-cloudfire/          # Self-service client portal (portal.wisrovi.dev)
└── admin-web/                 # Super-admin master console (admin.wisrovi.dev)
```

---

## 🔒 5-Tier Security & Operational Flow

1. **Thin Client (VS Code Webview)**: The visual canvas captures user interactions without compiling Python directly; it securely delegates compilation and AST operations to the local daemon via IPC.
2. **Ed25519 Cryptographic Verification**: The Cloudflare Worker (`api.wisrovi.dev`) digitally signs 30-day lease tokens. The local daemon mathematically verifies the signature using its embedded public key without requiring permanent network connectivity.
3. **Machine Hardware Fingerprinting**: Lease tokens are cryptographically bound to motherboard UUID, CPU ID, and MAC address, preventing unauthorized transfer across machines.
4. **Strict Freemium Enforcement**:
   - **Free Tier**: Up to 5 blocks on canvas; restricts Pro-tier blocks (`Parallel`, `Background`, `AI Step`).
   - **Pro Tier**: Unlocks unlimited complexity, concurrency, smart AST code merging, and live debugging.
5. **Single Enforcement Point**: every value-producing engine endpoint (`compile`, `transform`, `simulate`, project create/update/duplicate) is gated by `enforce_entitlements`. Limits come from the signed `ent` claim (D1 `plan_entitlements`), never from the browser or request bodies.
6. **System Isolation & OS Packaging (`daemon_os`)**: The engine distributes as an immutable package (`snap`), system package (`apt`), or closed binary compiled with Nuitka.

---

## 🧪 Testing and Verification

### 1. Daemon Unit & Security Tests
```bash
cd daemon_os
pytest tests/ -v
```

### 2. Cloudfire TypeScript Typecheck
```bash
cd cloudfire
npx tsc --noEmit
```

### 3. Portal & Admin Builds
```bash
cd portal-cloudfire && npm run build
cd ../admin-web && npm run build
```

---

## ⚖️ Copyright, Authorship & Intellectual Property Rights

> [!NOTE]
> **Official Intellectual Property and Attribution Statement**  
> This project and all associated orchestration models, visual interfaces, and engineering specifications are copyrighted and maintained under the terms below.

### Platform & Engineering Ecosystem
- **Platform**: [WPipe Studio](https://github.com/wisrovi/wpipe-studio) (wisrovi SUITE)
- **Core Engine**: [WPipe](https://github.com/wisrovi/wpipe) (wisrovi SUITE) `>=2.5.13`
- **Official Portal**: [https://portal.wisrovi.dev](https://portal.wisrovi.dev)
- **Official Admin**: [https://admin.wisrovi.dev](https://admin.wisrovi.dev)

### Lead Architect & Author Attribution
- **Lead Author & Solutions Architect**: **William Rodriguez** ([wisrovi](https://wisrovi.dev))
- **Title**: **AI Leader & Solutions Architect**
- **Website**: [https://wisrovi.dev](https://wisrovi.dev)
- **Location**: Badajoz, Extremadura, Spain
- **Mission**: *Bridging advanced artificial intelligence, distributed cloud architectures, and high-performance execution systems.*

### Intellectual Property & Terms of Use
All software components, visual block representations, topological graph compilation logic, typed DTO contracts, and orchestration abstractions are the exclusive intellectual property of **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Unauthorized removal or alteration of authorship metadata is strictly prohibited.

**Copyright © 2026 wisrovi ([wisrovi.dev](https://wisrovi.dev)). All Rights Reserved.**
