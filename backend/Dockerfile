# WPipe Studio Backend Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY ./app ./app

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    STUDIO_MEDIA_DIR=/app/media \
    PORT=8000

# Mount point for shared media volume from host
RUN mkdir -p /app/media

EXPOSE 8000

# Start FastAPI application with Uvicorn
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
