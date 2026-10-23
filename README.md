# wpipe-studio

**Enterprise Multi-Tenant SaaS and Visual Pipeline Engineering Platform for Designing WPipe Workflows and Generating Production-Ready Verified Python Microservices.**

> **AI Agents & Contributors:** Please read [`AGENTS.md`](./AGENTS.md) in full before making any modifications.  
> It contains finalized architectural decisions (`[DECIDED]`), intermediate representation (IR) specifications, sandbox security guardrails, and real-world edge cases to avoid.

---

## What It Does

1. **Plans** — Converts natural language specifications and visual diagrams into an executable work plan.
2. **Generates** — Produces a complete 36-file production microservice: FastAPI + WPipe DAG + Pydantic Context DTOs + Docker + Makefile + Pytest suite.
3. **Verifies** — Executes a comprehensive quality battery in an isolated Docker sandbox, iterating with code-fixing logic until all quality gates pass.
4. **Delivers** — Packages a validated, runnable ZIP microservice with zero broken dependencies.

**The single criterion of success:** `app/pipelines.py` runs end-to-end and passes all linting, typing, and testing checks (`black` · `isort` · `ruff` · `mypy` · `pytest` code coverage ≥ 60% · `dry_run_pipeline`).

---

## Core Technologies and Relevant Libraries

The **WPipe Studio** ecosystem integrates high-performance, enterprise-grade technologies tailored for isolation, security, and developer productivity:

| Layer | Key Technologies & Libraries |
|---|---|
| **Frontend & PWA** | **React 18** (concurrent rendering), **TypeScript** (strict type safety), **Vite** (fast HMR and bundling), **Tailwind CSS** (utility-first dark design system), **Google Blockly** (`blockly`, visual Scratch 3.0 puzzle canvas), **Mermaid JS** & **D3** (reactive directed acyclic graph visualization with pan & zoom), **PrismJS** (syntax highlighting overlay for Python, YAML, Dockerfile, Makefile, JSON), **Marked** (GFM Markdown rendering engine), **Lucide React** (VS Code icon set), **PWA Service Worker** (`sw.js` for offline cache), **WebCrypto API** (native Ed25519 cryptographic token verification). |
| **Backend & Local Daemon** | **Entitlement Enforcer** (`core/limiter.py` + `core/entitlements.py`, signed D1 plan limits), **FastAPI** (asynchronous Python 3.11 web framework), **Uvicorn** (ASGI server), **WPipe** (`>=2.5.13`, core pipeline orchestration engine), **WPipe Engine Daemon** (system service running on `127.0.0.1:49152` and Unix Domain Sockets `/tmp/wpipe.sock` with W3C Private Network Access), **WPipe Steps** (`>=1.0.2`, official 197-step pack catalog), **Pydantic v2 & Pydantic-Settings** (schema validation and settings management), **WPostgreSQL** (Data Access Layer with Pydantic models and connection pooling), **WSQLite** (lightweight persistence fallback), **Psycopg 3 & Psycopg-Pool** (PostgreSQL driver with thread-safe connection pooling), **Pytest & Pytest-Cov** (test runner and coverage). |
| **Infrastructure & Edge Cloud** | **Cloudflare Pages** (`studio.wisrovi.dev` and `wpipe-studio.pages.dev`), **Docker & Docker Compose** (multi-container orchestration), **PostgreSQL 15** (relational database), **PgAdmin 4** (web management console on port 1717), **Nginx Alpine** (lightweight production web server and reverse proxy), **Persistent Host Volumes** (`./media` for microservices and `./enviroment/db` for database data). |

### Architectural Highlights
- **PostgreSQL 15 & `wpostgresql`**: Enterprise data persistence following the Data Access Layer pattern with typed repositories (`UserRepository`, `ProjectRepository`, `TokenRepository`) and automated schema synchronization via `TableSync` migrations at FastAPI startup, with transparent fallback to SQLite for lightweight offline execution.
- **Top Menu Bar (Desktop IDE Style)**: 6 structured English menus (`File`, `Microservices`, `Edit`, `View`, `Run`, `Help`), interactive microservice breadcrumb (`📁 microservices / {projectName}`), local engine status widget, dedicated `👑 PRO` badge modal, and unified `Account` profile dropdown.
- **Responsive Auto-Resize Sync**: Reactive layout synchronization triggering `window.resize` events across 0ms, 30ms, and 150ms intervals whenever Split View (`Ctrl+\`), Bottom Panel / Terminal (`Ctrl+\``), or Sidebar (`Ctrl+B`) are toggled, preventing black screens and ensuring 100% viewport adaptation.
- **Proportional Mermaid DAG in README**: Compact horizontal flowchart (`flowchart LR`) rendered in an elegant dark card (max height 220px, soft shadows, rounded borders), preventing visual distortion in technical documentation.
- **Web-to-Local Engine Bridge & W3C Private Network Access (PNA)**: Secure communication between the HTTPS web PWA and the local `wpipe-engine` daemon (`http://127.0.0.1:49152`) using `Access-Control-Allow-Private-Network: true` preflight headers.
- **Native Ed25519 Cryptographic Verification**: Client-side JWS token signature verification using `window.crypto.subtle.verify` with the official wisrovi.dev sovereign public key, ensuring tamper-proof license tiers (Free vs. Pro).

---

## Unified Visual Interface Architecture

WPipe Studio features an integrated **VS Code-inspired** workspace:

1. **Top Menu Bar (`h-11`)**:
   - **6 Primary Menus**: `File`, `Microservices`, `Edit`, `View`, `Run`, and `Help`.
   - **Interactive Breadcrumb**: Fast microservice switching and inline renaming.
   - **Quick Actions**: Green flag simulation (`🏁`), syntax check (`Dry-Run AST`), export, and profile management.
2. **Global Activity Bar (`w-12`, `#181818`)**:
   - Single unified navigation rail for the entire application:
     - `🧩 Blocks (Design)`: Displays the 11-block Scratch puzzle palette and focuses Blockly Canvas.
     - `📁 File Explorer`: Displays the hierarchical microservice project tree.
     - `🎮 Simulation`: Step-by-step interactive testing with real-time context inspection.
     - `📊 Flowchart`: Interactive Mermaid DAG with pan, zoom, and SVG export.
     - `🔍 Search`: Workspace-wide search across files and blocks.
     - `🌿 Source Control (Git)`: Pending modification tracker and ZIP bundle generator.
3. **Primary Collapsible Sidebar (`w-72`, `#252526`)**:
   - Toggleable via `Ctrl+B`, activity bar icons, or the `<PanelLeft />` button.
   - Dynamically adapts its content based on the active tool.
4. **Blockly Visual Canvas**:
   - Infinite pan and zoom canvas with DOM permanence (retains blocks across tab switches).
   - Free canvas drag (`move.drag`), individual block collapse (`[-]` / `[+]`), and floating toolbar (Center, Fit, Collapse All, Expand All, Undo, Clear, Guide).
   - Real-world control C-blocks: `Condition` (single & dual branch), `For` (N iterations), `While` (conditional loops), `Parallel` (concurrent branches with `accumulate` merge policy), and `Background` (non-blocking async tasks).
5. **Interactive Simulation & Debugging Stage**:
   - Fullscreen sandbox with Green Flag (`🏁`) start, Red Stop (`🛑`), and Reset controls.
   - Pre-configured payload presets (REST, Kafka, Redis, Cron) and editable JSON input simulator.
   - Real-time Context Mutation Table displaying step-by-step state changes (`simContext`).
   - Breakpoint debugging (`🔴`) pausing execution on demand with `F5` (Continue) and `F10` (Step).
6. **Retractable Multi-Tab Bottom Panel (`Ctrl+\``)**:
   - 6 functional tabs: `TERMINAL` (interactive bash shell), `OUTPUT` (execution logs), `PROBLEMAS` (linter and AST syntax diagnostics), `DEBUGGER` (breakpoints and state inspection), `TESTS` (pytest suite runner), and `HISTORY` (persisted simulation run logs).

---

## Engine-Gated Features & Tamper-Proof Licensing

`studio.wisrovi.dev` behaves differently depending on whether the local **wpipe-engine** (`127.0.0.1:49152`) is running:

| Capability | Without engine | With engine (Free) | With engine (verified Pro) |
|---|---|---|---|
| Identity shown | `Guest · No Engine` | `Local Engine` | Verified license holder |
| Canvas blocks | Max 5 (UX guard) | Max 5 (enforced by engine) | Limits from signed `ent` claim |
| Parallel / Background / AI Step | 🔒 PRO | 🔒 PRO (engine `403`) | Allowed |
| Simulation | `Demo Simulation (FAKE)` with banner and `[FAKE-DEMO]` logs | Real engine simulation (`[ENGINE]`) | Real engine simulation |
| Python microservice / ZIP / projects / terminal / tests | 🔒 Local Engine Required | Generated and stored by the engine | Generated and stored by the engine |
| Export / import `.wpipe` design | ✅ (design only) | ✅ (limits re-applied on save) | ✅ |

**Why DevTools cannot bypass it:** the browser no longer contains a code generator or project storage. Everything with value happens inside the engine, which checks every request against the entitlements of an Ed25519-signed lease token (issued by the Cloudflare Worker from the D1 `plan_entitlements` table and bound to the machine fingerprint). UI flags such as `isPro` are display-only: the frontend re-verifies the token with WebCrypto against the embedded wisrovi public key, and the engine ignores any `is_pro` sent in request bodies.

---

## Deployment with Docker Compose

Both backend and frontend, together with PostgreSQL and PgAdmin, are orchestrated in `docker-compose.yml`:

```bash
# Build and start all services in the background:
docker-compose up -d --build

# Verify container status and healthchecks:
docker-compose ps

# Follow logs in real time:
docker-compose logs -f

# Stop all services:
docker-compose down
```

### Default Port Mappings
- **Frontend SPA**: `http://localhost:5173`
- **Backend API & Swagger**: `http://localhost:8000/docs`
- **PgAdmin 4 Console**: `http://localhost:1717` (wisrovi@wisrovi.dev / admin)
- **PostgreSQL 15**: `localhost:5432` (`wpostgresql`)
- **Shared Host Storage**: `./media/`

---

## How to Run Tests and Verify Code Coverage

### 1. Local Execution with Pytest
```bash
cd backend
python3 -m pytest -q
```

### 2. Code Coverage Report
```bash
./run_coverage.sh
```

### 3. Execution Inside Docker Container
All unit and regression tests can be run inside an isolated Docker container:
```bash
./run_tests_docker.sh
```

---

## Project Status & Ecosystem

| Component | Status & Specifications |
|---|---|
| **Phase** | Sprint 0 Complete — Pydantic/Zod IR, Catalog Service, Scratux 3.0 Canvas, Control C-Blocks (`Condition`, `For`, `Parallel`), Dialect A DTOs, and Real-Time Simulation. |
| **Ecosystem** | Integrated in `wpipe_os/` alongside `wpipe` 2.5.13, `wpipe-steps` (**197 steps**), `wpipe-plugins`, `wpipe-mcp`, and `wpipe-api`. |
| **Step Catalog** | `steps_catalog.json` serves as the authoritative release manifest (queried via cached GET request with SHA-256 validation). |

---

## Documentation

Full architectural specifications and development rules are available in [`AGENTS.md`](./AGENTS.md):
- §1 Purpose & Success Criteria
- §2 Ecosystem Architecture
- §3 Past Decisions & Trade-Offs
- §4 Vision & Verification Loop
- §5 Target Microservice Packaging
- §6 Technical Architecture & IR Schemas
- §7 Repository Rules
- §8 Decision Log
- §9 Sprint Roadmap
- §10 Anti-Patterns

---

## ⚖️ Copyright, Authorship & Intellectual Property Rights

> [!NOTE]
> **Official Intellectual Property and Attribution Statement**  
> This project and all associated orchestration models, visual interfaces, and engineering specifications are copyrighted and maintained under the terms below.

### Platform & Engineering Ecosystem
- **Platform**: [WPipe Studio](https://github.com/wisrovi/wpipe-studio) (wisrovi SUITE)
- **Core Engine**: [WPipe](https://github.com/wisrovi/wpipe) (wisrovi SUITE) `>=2.5.13`
- **Official Portal**: [https://studio.wisrovi.dev](https://studio.wisrovi.dev)

### Lead Architect & Author Attribution
- **Lead Author & Solutions Architect**: **William Rodriguez** ([wisrovi](https://wisrovi.dev))
- **Title**: **AI Leader & Solutions Architect**
- **Website**: [https://wisrovi.dev](https://wisrovi.dev)
- **Location**: Badajoz, Extremadura, Spain
- **Mission**: *Bridging advanced artificial intelligence, distributed cloud architectures, and high-performance execution systems.*

### Intellectual Property & Terms of Use
All software components, visual block representations, topological graph compilation logic, typed DTO contracts, and orchestration abstractions are the exclusive intellectual property of **wisrovi** ([wisrovi.dev](https://wisrovi.dev)). Unauthorized removal or alteration of authorship metadata is strictly prohibited.

**Copyright © 2026 wisrovi ([wisrovi.dev](https://wisrovi.dev)). All Rights Reserved.**
