"""WPipe Studio Backend FastAPI Application Entrypoint."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as api_v1_router
from app.core.config import settings
from app.core.logging import configure_logging, get_logger
from app.migrations.manager import run_migrations

configure_logging()
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan managing database synchronization."""
    try:
        mig_result = run_migrations()
        logger.info("WPostgreSQL database migration check completed: %s", mig_result)
    except Exception as e:
        logger.warning("WPostgreSQL migration check skipped or failed on startup: %s", e)
    yield


app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["health"])
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_v1_router, prefix=settings.api_v1_prefix)