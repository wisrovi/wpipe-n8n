# WPipe Studio — Super-Admin Web Console

A secure, serverless super-administrative web application designed for William Rodriguez to manage the complete lifecycle of WPipe Studio floating licenses, enterprise seats, active worker leases, and Cloudflare D1 database operations with zero operational cost.

- **Production URL**: [https://wpipe-admin.pages.dev](https://wpipe-admin.pages.dev) (Custom domain: `https://admin.wisrovi.dev`)
- **Backend API**: Cloudflare Worker at `https://api.wisrovi.dev`
- **Hosting**: Cloudflare Pages (Free Tier: 0 €/month, globally distributed edge CDN)

---

## 🛠️ Core Technologies and Relevant Libraries

This component utilizes an optimized technology stack engineered for speed, strict security, and minimal resource consumption:

| Technology / Library | Version / Type | Purpose in Ecosystem |
| :--- | :--- | :--- |
| **React** | `^18.3.1` | Declarative UI library for high-frequency admin state and reactive updates. |
| **Vite** | `^5.4.21` | High-speed ESM build tool and local development server. |
| **TypeScript** | `^5.6.3` | Strict type definitions for licenses, leases, and Cloudflare D1 queries. |
| **Tailwind CSS** | `^3.4.14` | Utility-first styling framework with high-contrast dark theme. |
| **Lucide React** | `^0.453.0` | Enterprise iconography for security indicators, telemetry, and database tools. |
| **Cloudflare Pages** | Serverless Edge | Global edge CDN hosting with automated SSL and DDoS mitigation. |
| **Cloudflare D1** | SQLite at Edge | Distributed relational database storing license records and audit trails. |
| **Cloudflare Workers** | Edge Compute | Master Key-authenticated REST microservices handling CRUD operations and SQL execution. |

---

## 🚀 Key Administrative Capabilities & Safeguards

1. **Destructive SQL Safeguards & Raw D1 Console**:
   - Built-in SQL editor with interactive schema explorer for all tables (`licenses`, `leases`, `audit_logs`, `otp_codes`, `activations`).
   - Safety validation blocking accidental destructive operations (`DROP`, `TRUNCATE`, unconstrained `DELETE`) without explicit double-confirmation.
   - Execution duration telemetry (`duration ms`) and exportable result sets (CSV, JSON).
2. **Live Metrics Dashboard & NOC Telemetry**:
   - Total registered and active licenses with floating lease count.
   - License distribution bar across tiers (`Starter`, `Pro`, `Enterprise`, `VIP/Partner`).
   - Expiration guardian table (<30 days remaining) with 1-click renewal.
   - NOC Auto-Refresh configurable (`OFF`, `10s`, `30s`, `60s`) with Cloudflare edge ping latency.
3. **Global & Batch License Management**:
   - Batch operations toolbar: activate, suspend, or expand seats across multiple licenses at once.
   - Instant search by email, license key, or customer name.
   - Live hardware inspection drawer showing connected machines, hostnames, and SHA-256 fingerprints.
   - Quick extension controls (`+30 Days`, `+90 Days`, `+1 Year`, `Lifetime`).
4. **VIP Minter & Sovereign Partner Onboarding**:
   - Direct minting of commercial and VIP partner licenses bypassing payment webhooks.
   - 1-click deep link generation (`vscode://wisrovi.wpipe-studio-vscode/activate?key=...`).
   - Visual QR code generator and Markdown welcome email builder with CLI terminal instructions.
5. **Floating Lease Monitor & Hardware Inspector**:
   - Real-time inspection of active workstations (hostname, OS, hardware fingerprint).
   - 1-click machine eviction (kick) to free up occupied floating seats.
   - Instant purge of expired leases.
6. **Audit Trail**:
   - Log of the last 100 license and webhook lifecycle events with CSV export.

---

## 💻 Local Development & Deployment

### Prerequisites
- Node.js 18+
- npm

### Installation & Development Server
```bash
cd vscode-extension/admin-web
npm install
npm run dev
```

### Production Build
```bash
npm run build
```

### Deploy to Cloudflare Pages
```bash
npx wrangler pages deploy dist --project-name=wpipe-admin --branch=main --commit-dirty=true
```

---

## ⚖️ Copyright, Authorship & Intellectual Property Rights

> [!NOTE]
> **Official Intellectual Property and Attribution Statement**  
> This administrative console and all associated management logic are copyrighted and maintained under the terms below.

### Platform & Engineering Ecosystem
- **Platform**: [WPipe Studio](https://github.com/wisrovi/wpipe-studio) (wisrovi SUITE)
- **Official Admin**: [https://admin.wisrovi.dev](https://admin.wisrovi.dev)

### Lead Architect & Author Attribution
- **Lead Author & Solutions Architect**: **William Rodriguez** ([wisrovi](https://wisrovi.dev))
- **Title**: **AI Leader & Solutions Architect**
- **Website**: [https://wisrovi.dev](https://wisrovi.dev)
- **Location**: Badajoz, Extremadura, Spain
- **Mission**: *Bridging advanced artificial intelligence, distributed cloud architectures, and high-performance execution systems.*

### Intellectual Property & Terms of Use
All software components, visual block representations, and orchestration abstractions are the exclusive intellectual property of **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Unauthorized removal or alteration of authorship metadata is strictly prohibited.

**Copyright © 2026 wisrovi ([wisrovi.dev](https://wisrovi.dev)). All Rights Reserved.**
