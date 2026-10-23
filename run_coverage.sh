#!/usr/bin/env bash
set -e

echo "Calculating test coverage in backend..."
cd backend
python3 -m pytest --cov=app --cov-report=term-missing --cov-report=html:htmlcov tests/
echo "Coverage report generated in backend/htmlcov/"
