#!/bin/bash
set -e

# ==============================================================================
# WPipe Studio - Cloudflare Deployment Script
# Author: William Rodriguez (wisrovi.dev)
# ==============================================================================

echo "🚀 Iniciando despliegue de WPipe Licensing Authority en Cloudflare..."

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# 1. Check Wrangler CLI
if ! command -v wrangler &> /dev/null && ! npx wrangler --version &> /dev/null; then
    echo "❌ Error: wrangler no está instalado. Ejecute: npm install"
    exit 1
fi

# 2. Check if keys.json exists, if not generate them
if [ ! -f "keys.json" ]; then
    echo "🔑 Generando par de claves Ed25519..."
    node scripts/generate_keypair.js
fi

# 3. Create D1 database if not already created
echo "📦 Verificando base de datos D1 (wpipe_licenses)..."
echo "Si es la primera vez, ejecute:"
echo "  npx wrangler d1 create wpipe_licenses"
echo "Y copie el 'database_id' en wrangler.toml."

# 4. Initialize schema on Cloudflare D1
echo "📄 Aplicando esquema SQL en D1 (remoto)..."
npx wrangler d1 execute wpipe_licenses --remote --file=schema.sql

# 5. Create R2 bucket for zero-egress downloads
echo "🪣 Verificando bucket Cloudflare R2 (wpipe-releases)..."
npx wrangler r2 bucket create wpipe-releases 2>/dev/null || true

# 6. Deploy Worker
echo "🌐 Desplegando Worker en Cloudflare Edge..."
npx wrangler deploy

echo "✅ ¡Despliegue completado exitosamente en Cloudflare!"
echo "Puntos de enlace activos:"
echo "  - https://api.wisrovi.dev/v1/health"
echo "  - https://api.wisrovi.dev/v1/license/activate"
echo "  - https://api.wisrovi.dev/v1/license/verify"
echo "  - https://api.wisrovi.dev/v1/downloads/latest"
