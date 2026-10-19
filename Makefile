.PHONY: help start stop restart status logs clean test

help:
	@echo "WPipe Studio — Management Commands"
	@echo "  make start     - Start backend, frontend, postgres and pgadmin in Docker Compose"
	@echo "  make stop      - Stop all running containers"
	@echo "  make restart   - Restart all containers"
	@echo "  make status    - Show container status"
	@echo "  make logs      - Follow container logs"
	@echo "  make test      - Run backend unit tests"
	@echo "  make clean     - Clean temporary and cache files"

start:
	docker-compose up -d --build

stop:
	docker-compose down

restart:
	docker-compose restart

status:
	docker-compose ps

logs:
	docker-compose logs -f

test:
	cd backend && python3 -m pytest tests/

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type d -name ".pytest_cache" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
