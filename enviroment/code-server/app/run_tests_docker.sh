#!/usr/bin/env bash
set -e

echo "=========================================================="
echo " Running Automated WPipe Tests via Makefile"
echo " Microservice: main_pipeline"
echo "=========================================================="

make test

echo "=========================================================="
echo " Tests finished successfully in Docker! ✓"
echo "=========================================================="
