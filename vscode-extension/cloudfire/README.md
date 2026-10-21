# WPipe Studio — Cloudflare Licensing & Distribution Authority

Servidor de autoridad de licencias y distribución de binarios serverless para el ecosistema **WPipe Studio (wisrovi SUITE)** ejecutándose en la red edge global de **Cloudflare**.

> **Autor**: William Rodriguez (AI Leader & Solutions Architect — [wisrovi.dev](https://wisrovi.dev))  
> **Coste de Infraestructura**: **0 € / mes** (100.000 peticiones diarias gratis en Workers, 5M lecturas en D1, 10 GB y ancho de banda ilimitado en R2).

---

## Tecnologías y Librerías Relevantes

| Tecnología | Rol en el Ecosistema |
|---|---|
| **Cloudflare Workers** | Servidor de licencias serverless sin infraestructura dedicada (`api.wisrovi.dev`). |
| **Cloudflare D1** | Base de datos SQLite distribuida globalmente con latencia ultra-baja. |
| **Cloudflare R2** | Almacenamiento de objetos compatible con S3 sin coste de descarga (*Zero Egress Fees*) para distribuir los binarios del daemon. |
| **Criptografía Ed25519 (WebCrypto API)** | Firma asimétrica de tokens de arrendamiento (*leases*) con clave privada segura. |
| **TypeScript & Wrangler** | Entorno de desarrollo tipado y CLI oficial de despliegue en Cloudflare. |

---

## Estructura del Proyecto

```
cloudfire/
├── wrangler.toml              # Configuración de bindings D1, R2 y variables de entorno
├── schema.sql                 # Esquema D1: licenses, leases (asientos flotantes), activations, audit_logs
├── package.json               # Dependencias de compilación y scripts de despliegue
├── tsconfig.json              # Configuración de compilador TypeScript
├── keys.json                  # Par de claves Ed25519 generado (archivo protegido)
├── scripts/
│   ├── generate_keypair.js    # Generador de par de claves Ed25519
│   └── deploy.sh              # Script automatizado de despliegue
└── src/
    ├── index.ts               # Router HTTP principal con soporte CORS completo
    ├── crypto/
    │   └── ed25519.ts         # Módulo de firma criptográfica de tokens JWS/JWT
    └── routes/
        ├── lease.ts           # POST /v1/license/lease, /heartbeat, /release (TTL 2h, ping 30m)
        ├── portal.ts          # Endpoints de autoservicio para portal.wisrovi.dev (/v1/portal/*)
        ├── admin.ts           # Super-Admin endpoints de bajo nivel (/v1/admin/*)
        ├── activate.ts        # POST /v1/license/activate
        ├── verify.ts          # POST /v1/license/verify
        ├── webhooks.ts        # POST /v1/webhooks/payment
        └── downloads.ts       # GET /v1/downloads/*
```

---

## Guía de Puesta en Marcha Rápida

### 1. Instalar dependencias
```bash
npm install
```

### 2. Generar el par de claves criptográficas
```bash
node scripts/generate_keypair.js
```
El script generará el archivo `keys.json` con la clave privada para Cloudflare y la clave pública para el `daemon_os`.

### 3. Crear los recursos en Cloudflare (Solo la primera vez)
```bash
# Iniciar sesión en Cloudflare
npx wrangler login

# Crear base de datos D1
npx wrangler d1 create wpipe_licenses

# Crear bucket R2 para binarios
npx wrangler r2 bucket create wpipe-releases
```
*Copia el `database_id` devuelto en el comando anterior dentro de `wrangler.toml`.*

### 4. Configurar el Secreto de la Clave Privada
```bash
npx wrangler secret put LICENSE_PRIVATE_KEY
# Pega el valor de private_key_pkcs8_base64 que se generó en keys.json
```

### 5. Desplegar
```bash
./scripts/deploy.sh
```

---

## Endpoints de la API

### 1. Salud del Servicio
- **URL**: `GET https://api.wisrovi.dev/v1/health`

### 2. Activación de Licencia (VS Code / Daemon)
- **URL**: `POST https://api.wisrovi.dev/v1/license/activate`
- **Body**:
  ```json
  {
    "license_key": "WPIPE-PRO-DEMO-TEST-KEY-2026",
    "machine_fingerprint": "a9f81234b5c6d7e8",
    "hostname": "workstation-william",
    "os": "linux"
  }
  ```
- **Respuesta**:
  ```json
  {
    "status": "success",
    "plan": "pro",
    "lease_token": "eyJhbGciOiJFZERTQSI...",
    "expires_at": "2026-11-18T12:00:00.000Z",
    "grace_period_days": 7
  }
  ```

### 3. Renovación Periódica de Arrendamiento (Heartbeat cada 30 días)
- **URL**: `POST https://api.wisrovi.dev/v1/license/verify`
- **Body**:
  ```json
  {
    "license_key": "WPIPE-PRO-DEMO-TEST-KEY-2026",
    "machine_fingerprint": "a9f81234b5c6d7e8"
  }
  ```

### 4. Webhook de Pasarela de Pagos (Stripe / Lemon Squeezy)
- **URL**: `POST https://api.wisrovi.dev/v1/webhooks/payment`
- Al completarse una compra en `wisrovi.dev`, emite una nueva clave `WPIPE-PRO-XXXX-XXXX-XXXX` y la registra en la base de datos D1.

### 5. Descargas de Binarios sin Coste de Tráfico (Cloudflare R2)
- **URL**: `GET https://downloads.wisrovi.dev/wpipe-engine/latest/wpipe-engine-linux-x64.tar.gz`
