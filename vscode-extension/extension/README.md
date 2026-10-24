# WPipe — Official VS Code Extension

Visual pipeline designer, native step registry, live DAG analysis, and microservice generator for **WPipe** inside **Visual Studio Code**.

> **Author**: William Steve Rodriguez Villamizar (Wisrovi) — [wisrovi.dev](https://wisrovi.dev)  
> **Official Email**: `wisrovi.rodriguez@gmail.com`  
> **Ecosystem**: WPipe OS / wisrovi SUITE  
> **Version**: 2.0.0

---

## Overview

`wpipe-vscode` unifies the mature native language tools of WPipe (AST parsing, Step Registry, CodeLens, Live DAG Preview, and Diagnostics) with the visual pipeline canvas and the high-performance local compilation engine (`wpipe-engine`).

---

## Key Features

1. **Native Step Registry (`wpipeSteps`)**:
   - Live Activity Bar explorer indexing the **196 official steps** from `wpipe-steps`, community plugins, and your local workspace steps.
   - One-click import generation and step execution.

2. **Interactive Live DAG Preview (`DAGPanel`)**:
   - Full flowchart visualization powered by Mermaid and Lezer AST parser.
   - Two-way navigation: click on any node to jump directly to its definition (`gotoLine`).
   - Algorithmic computational complexity inspection (Big-O analysis) and high-resolution export (SVG/PNG).

3. **Python Pipeline Intelligence**:
   - **CodeLens**: One-click actions over `@step` (*Run Step*), pipeline definitions (*Preview DAG*, *Run Pipeline*, *Open Dashboard*), and `.set_steps(...)` (*Add Logic Block*).
   - **Hover Documentation**: Immediate access to step versions, author, and documentation.
   - **QuickFix Code Actions**: Convert Python functions into decorated WPipe steps.
   - **Rich Snippets**: Pre-configured templates for Python and YAML.

4. **Visual Pipeline Canvas (`*.wpipe`, `*.wpipe.json`)**:
   - Interactive visual block canvas.
   - Direct compilation to production microservices (`app/pipelines.py`, `app/states/`, `Dockerfile`, `Makefile`, and `tests/`).
   - Seamless AST merge preserving custom user logic.

5. **Integrated Engine Daemon (`wpipe-engine`)**:
   - Native local execution daemon with zero cloud overhead.
   - Cryptographically verified Ed25519 licensing with seat management.
   - Step-by-step local simulation with accurate traceback attribution.

---

## Commands

- `WPipe: Preview Pipeline DAG`
- `WPipe: Open Block Canvas`
- `WPipe: Create New Visual Pipeline`
- `WPipe: Create New Advanced Step`
- `WPipe: Search & Import Steps (Catalog)`
- `WPipe: Refresh Cloud Catalog`
- `WPipe: Open Web Dashboard`
- `WPipe: Replay Log Errors`
- `WPipe: Find Step Usage (Impact Analysis)`
- `WPipe: Show Cheat Sheet / Help`
- `WPipe: Compile Pipeline to Python`
- `WPipe: Start Native Engine (wpipe-engine)`
- `WPipe: Stop Native Engine (wpipe-engine)`
- `WPipe: Check License Status`
- `WPipe: Activate Pro License Key`

---

## Building and Packaging (.vsix)

```bash
# 1. Install dependencies
npm install

# 2. Compile bundle with esbuild
npm run compile

# 3. Package extension
npx vsce package --no-git-tag-version
```

Installs into VS Code via:
```bash
code --install-extension wpipe-vscode-2.0.0.vsix --force
```

---

## License

Proprietary © William Steve Rodriguez Villamizar (Wisrovi). All rights reserved.
