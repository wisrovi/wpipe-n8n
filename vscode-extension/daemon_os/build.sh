#!/bin/bash
set -e

# ==============================================================================
# WPipe Engine - Binary Compilation Script
# Compiles Python daemon to standalone binary using PyInstaller or Nuitka
# Author: William Rodriguez (wisrovi.dev)
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "🔨 Compilando wpipe-engine a binario nativo cerrado..."

OUTPUT_DIR="dist"
mkdir -p "$OUTPUT_DIR"

if command -v nuitka &> /dev/null || python3 -m nuitka --version &> /dev/null; then
    echo "⚡ Usando compilador Nuitka C..."
    python3 -m nuitka \
        --standalone \
        --onefile \
        --remove-output \
        --output-dir="$OUTPUT_DIR" \
        -o wpipe-engine \
        wpipe_engine/main.py
elif command -v pyinstaller &> /dev/null || python3 -m PyInstaller --version &> /dev/null; then
    echo "📦 Usando PyInstaller..."
    python3 -m PyInstaller \
        --onefile \
        --name wpipe-engine \
        --distpath "$OUTPUT_DIR" \
        wpipe_engine/main.py
else
    echo "⚠️ Ni Nuitka ni PyInstaller están instalados."
    echo "Instale uno con: pip install nuitka"
    echo "Creando symlink ejecutable para desarrollo..."
    ln -sf "$DIR/wpipe_engine/main.py" "$OUTPUT_DIR/wpipe-engine"
fi

chmod +x "$OUTPUT_DIR/wpipe-engine"
echo "✅ Binario listo en: $OUTPUT_DIR/wpipe-engine"
