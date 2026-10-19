#!/bin/bash
set -e

# ==============================================================================
# WPipe Studio - Admin Dashboard Test Runner with Docker & Coverage
# Author: William Rodriguez (wisrovi.dev)
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

echo "🧪 Ejecutando suite de pruebas unitarias y cálculo de cobertura..."

# Check if Docker is available
if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo "🐳 Ejecutando pruebas dentro de contenedor Docker aislado (python:3.11-slim)..."
    docker run --rm \
        -v "$DIR:/app" \
        -w /app \
        python:3.11-slim \
        bash -c "pip install --no-cache-dir pytest pytest-cov pandas requests && pytest tests/ -v --cov=client --cov-report=term-missing --cov-report=html:tests/coverage_html"
else
    echo "⚙️ Docker no disponible o sin permisos de daemon; ejecutando localmente con pytest..."
    pytest tests/ -v --cov=client --cov-report=term-missing --cov-report=html:tests/coverage_html
fi

echo "✅ Pruebas finalizadas con éxito."
