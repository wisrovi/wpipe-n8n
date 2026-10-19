# WPipe Studio — VS Code Extension, Native Engine & Cloudflare Licensing

Suite completa para el diseño visual de pipelines WPipe y generación de microservicios Python integrados de forma nativa en **Visual Studio Code**, operando bajo una arquitectura **local-first** con coste de servidor de **0 €/mes** y blindaje comercial contra ingeniería inversa.

> **Autor**: William Rodriguez (AI Leader & Solutions Architect — [wisrovi.dev](https://wisrovi.dev))  
> **Ecosistema**: WPipe OS / wisrovi SUITE  
> **Modelo**: Freemium (≤ 5 bloques Free / Pro ilimitado con tokens Ed25519)

---

## Tecnologías y Librerías Relevantes

| Componente | Tecnologías y Librerías Clave |
|---|---|
| **`cloudfire/`** | **Cloudflare Workers** (servidor de licencias edge), **Cloudflare D1** (SQLite serverless), **Cloudflare R2** (Zero-Egress Object Storage), **WebCrypto API Ed25519** (firmas asimétricas), **TypeScript**, **Wrangler CLI**. |
| **`daemon_os/`** | **Python 3.11+ / CPython**, **PyCA Cryptography** (verificación de firmas Ed25519), **Unix Domain Sockets** (`socket.AF_UNIX`), **Localhost HTTP** (`127.0.0.1:49152`), **Nuitka / PyInstaller** (AOT compilation a binario cerrado), **Pytest** (suite de 13 pruebas unitarias). |
| **`extension/`** | **VS Code Extensibility API** (`CustomTextEditorProvider` para `*.wpipe`), **TypeScript 5**, **VS Code Webview API** (lienzo React + Blockly aislado), **Node.js HTTP/IPC**. |

---

## Estructura del Ecosistema

```
vscode-extension/
├── cloudfire/                 # Servidor de licencias Serverless (Cloudflare Edge)
│   ├── wrangler.toml          # Configuración de bindings D1 y R2
│   ├── schema.sql             # Base de datos D1: licenses, activations, audit_logs
│   ├── keys.json              # Par de claves asimétricas Ed25519
│   ├── src/                   # Router HTTP, firmas Ed25519, activación y webhooks
│   └── scripts/deploy.sh      # Script de despliegue en Cloudflare (api.wisrovi.dev)
│
├── daemon_os/                 # Motor nativo local de sistema (wpipe-engine)
│   ├── wpipe_engine/          # Core del daemon: licensing, enforcer freemium, AST compiler
│   ├── build.sh               # Compilador a binario nativo cerrado
│   ├── package/               # Empaquetado para SO: systemd, snapcraft.yaml
│   └── tests/                 # Suite de 13 pruebas unitarias (pytest)
│
└── extension/                 # Extensión para Visual Studio Code
    ├── package.json           # Manifiesto VS Code, comandos y editor *.wpipe
    ├── src/                   # Lifecycle, gestor del daemon, cliente IPC y Webview
    └── dist/                  # Bundle TypeScript compilado listo para empaquetar
```

---

## Flujo Operativo y Blindaje en 5 Niveles

1. **Cliente Fino (VS Code Webview)**: El lienzo visual captura la interacción del usuario pero no sabe compilar código Python; delega la compilación al daemon local mediante IPC.
2. **Criptografía Asimétrica Ed25519**: El Cloudflare Worker (`api.wisrovi.dev`) firma digitalmente tokens de arrendamiento (*leases*) válidos por 30 días. El daemon verifica matemáticamente la firma con su clave pública integrada sin requerir conexión continua.
3. **Anclaje al Hardware Físico (Machine Fingerprint)**: El lease se vincula al UUID de la placa base, ID de CPU y MAC del desarrollador. No puede ser transferido a otro equipo.
4. **Control Freemium Estricto**:
   - **Modo Free**: Permite hasta 5 bloques en el lienzo. Bloquea el uso de bloques Pro (`Parallel`, `Background`, `AI Step`).
   - **Modo Pro**: Desbloquea complejidad ilimitada, concurrencia, Smart AST code merge y depuración en vivo.
5. **Aislamiento y Empaquetado de Sistema (`daemon_os`)**: El motor nativo puede distribuirse como paquete inmutable (`snap`), paquete de sistema (`apt`), o binario cerrado compilado con Nuitka.
