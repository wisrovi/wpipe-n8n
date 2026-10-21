#!/bin/bash
# WPipe Studio - Calculate Unit Test Coverage for daemon_os
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "=========================================="
echo "⚙️ WPipe Engine (daemon_os) - Test Coverage"
echo "=========================================="

pytest --cov=wpipe_engine --cov-report=term-missing --cov-report=html:build/coverage_html tests/
echo "Coverage HTML report generated at: build/coverage_html/index.html"
