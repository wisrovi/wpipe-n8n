#!/bin/bash
# WPipe Studio - Calculate Unit Test Coverage for Cloudfire Admin
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

echo "=========================================="
echo "🛡️ WPipe Admin Cloudfire - Test Coverage"
echo "=========================================="

pytest --cov=. --cov-report=term-missing --cov-report=html:output/coverage_html tests/
echo "Coverage HTML report generated at: output/coverage_html/index.html"
