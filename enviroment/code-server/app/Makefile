# Makefile for main_pipeline (WPipe Microservice)
.PHONY: help start stop restart status logs into test pytest build clean

CONTAINER_NAME=main_pipeline_microservice
SERVICE_NAME=main_pipeline

help:
	@echo "Available commands for main_pipeline:"
	@echo "  make start     - Build and run microservice in detached Docker container"
	@echo "  make stop      - Stop running microservice container"
	@echo "  make restart   - Restart microservice container"
	@echo "  make status    - View container status and healthcheck"
	@echo "  make logs      - View container logs in real-time"
	@echo "  make into      - Open interactive bash shell inside running container"
	@echo "  make test      - Run automated unit and integration tests inside Docker"
	@echo "  make pytest    - Run local pytest suite with coverage"
	@echo "  make build     - Build production Docker image"
	@echo "  make clean     - Remove cache, coverage artifacts, and bytecode"

start:
	docker compose up -d --build

stop:
	docker compose down

restart: stop start

status:
	docker compose ps
	@curl -s http://localhost:8000/health || true

logs:
	docker compose logs -f $(SERVICE_NAME)

into:
	docker compose exec -it $(SERVICE_NAME) /bin/bash

test:
	docker compose run --rm $(SERVICE_NAME) pytest test/ -v

pytest:
	pytest test/ --cov=. --cov-report=term-missing

build:
	docker compose build

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	rm -rf .pytest_cache .coverage htmlcov output/
