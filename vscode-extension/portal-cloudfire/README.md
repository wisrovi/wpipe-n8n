# WPipe Studio — Enterprise Customer Self-Service Portal

Self-service enterprise portal for WPipe Studio corporate accounts. Enables license administrators and IT directors to manage concurrent floating seat leases, monitor active workstations in real time with heartbeat tracking, detach workstations with a single click, download pre-built extension binaries, and purge stale devices.

- **Production URL**: [https://portal.wisrovi.dev](https://portal.wisrovi.dev) (Cloudflare Pages: `wpipe-portal`)
- **Backend API**: Cloudflare Worker at `https://api.wisrovi.dev`
- **Hosting**: Cloudflare Pages (Free Tier: 0 €/month, globally distributed edge CDN)

---

## 🛠️ Core Technologies and Relevant Libraries

The Enterprise Customer Portal is built with modern, ultra-lightweight, and secure web technologies:

| Technology / Library | Version / Type | Purpose in Ecosystem |
| :--- | :--- | :--- |
| **React** | `^18.3.1` | Declarative UI framework for reactive component rendering and state management. |
| **Vite** | `^5.4.21` | High-speed ESM development server and production bundler. |
| **TypeScript** | `^5.6.3` | Rigorous static typing for floating seat leases, device payloads, and API contracts. |
| **Tailwind CSS** | `^3.4.14` | Utility-first CSS framework with dark theme and high-density enterprise UI. |
| **Lucide React** | `^0.453.0` | Comprehensive SVG icon set for developer tools, security indicators, and actions. |
| **Cloudflare Pages** | Serverless Edge | Global CDN hosting with automatic SSL certificates and sub-30ms global latency. |
| **Cloudflare Workers** | Edge Compute | Serverless backend API (`api.wisrovi.dev`) interfacing with Cloudflare D1. |
| **Cloudflare D1** | SQLite at Edge | Distributed relational database backing licenses, leases, and OTP challenge tokens. |

---

## 🔒 Armored Security & Core Capabilities

1. **Passwordless Corporate OTP Authentication**:
   - Authorized purchasers authenticate via corporate email with a 6-digit cryptographic OTP token (10-minute expiry, rate-limited to 5 requests per 15 minutes).
   - Generates a signed JWT session token (HS256) valid for 24 hours.
2. **Terminal Key vs. Admin Key Segregation**:
   - Terminal seat keys (`license_key`, e.g., `WPIPE-PRO-...`) are strictly blocked from portal login (`403 TERMINAL_KEY_NOT_ALLOWED`), preventing end-user developers from evicting peers.
   - Master Admin Keys (`admin_key`, e.g., `WPIPE-ADM-...`) provide direct access for IT directors.
3. **Seat Saturation Warning Banner**:
   - Real-time alert triggers when seat capacity hits 100%, offering instant 1-click stale workstation purge.
4. **Confidential Key Masking Toggle**:
   - Sensitive license keys and admin credentials can be masked (`••••-••••`) for secure screen-sharing in team meetings.
5. **Direct Binaries & Offline Package Downloads**:
   - Quick-download cards for `wpipe-studio-vscode.vsix` and native CLI engine installers with copyable installation commands.
6. **Radial Gauge & Fleet Telemetry**:
   - Interactive SVG tachometer displaying active vs. total floating seats with dynamic chromatic thresholds (Green, Amber, Red).
7. **Instant Seat Revocation & Fleet Purge**:
   - Individual release (`DELETE /v1/portal/seats/:id`) detaches orphaned machines in <50ms.
   - Batch release and purge stale workstations (>7 days inactive) free up capacity immediately.
8. **Developer Onboarding Modal (+ Invite Developer)**:
   - 1-click VS Code deep link (`vscode://wisrovi.wpipe-studio-vscode/activate?key=...`).
   - Terminal CLI command snippet (`wpipe-engine activate --key ...`).
   - Formatted copy-paste template for Slack, Discord, and Microsoft Teams.
   - High-contrast visual QR code for tablets and physical workstations.
9. **Dual IT Inventory Export (CSV & JSON)**:
   - Instant export of active machines, hostnames, platforms, and custom nicknames.

---

## 💻 Local Development & Deployment

### Prerequisites
- Node.js 18+
- npm

### Installation & Development Server
```bash
cd vscode-extension/portal-cloudfire
npm install
npm run dev
```

### Production Build
```bash
npm run build
```

### Deploy to Cloudflare Pages
```bash
npm run deploy
# Or directly with wrangler:
# npx wrangler pages deploy dist --project-name=wpipe-portal --branch=main --commit-dirty=true
```

---

## ⚖️ Copyright, Authorship & Intellectual Property Rights

> [!NOTE]
> **Official Intellectual Property and Attribution Statement**  
> This portal and all associated license orchestration models are copyrighted and maintained under the terms below.

### Platform & Engineering Ecosystem
- **Platform**: [WPipe Studio](https://github.com/wisrovi/wpipe-studio) (wisrovi SUITE)
- **Official Portal**: [https://portal.wisrovi.dev](https://portal.wisrovi.dev)

### Lead Architect & Author Attribution
- **Lead Author & Solutions Architect**: **William Rodriguez** ([wisrovi](https://wisrovi.dev))
- **Title**: **AI Leader & Solutions Architect**
- **Website**: [https://wisrovi.dev](https://wisrovi.dev)
- **Location**: Badajoz, Extremadura, Spain
- **Mission**: *Bridging advanced artificial intelligence, distributed cloud architectures, and high-performance execution systems.*

### Intellectual Property & Terms of Use
All software components, visual block representations, and orchestration abstractions are the exclusive intellectual property of **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Unauthorized removal or alteration of authorship metadata is strictly prohibited.

**Copyright © 2026 wisrovi ([wisrovi.dev](https://wisrovi.dev)). All Rights Reserved.**
