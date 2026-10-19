# ==============================================================================
# WPipe Studio - Licensing Admin Dashboard Dockerfile
# Author: William Rodriguez (wisrovi.dev)
# ==============================================================================

FROM python:3.11-slim

WORKDIR /app

# Set non-interactive and unbuffered environment
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STREAMLIT_SERVER_PORT=8501 \
    STREAMLIT_SERVER_ADDRESS=0.0.0.0 \
    STREAMLIT_SERVER_HEADLESS=true

# Install system utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy WPipe application architecture files
COPY dto/ ./dto/
COPY states/ ./states/
COPY app.py client.py pipelines.py ./

EXPOSE 8501

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8501/_stcore/health || exit 1

CMD ["streamlit", "run", "app.py"]
