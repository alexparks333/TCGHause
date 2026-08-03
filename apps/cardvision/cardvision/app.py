from contextlib import asynccontextmanager

from fastapi import FastAPI

from cardvision.api import cards, health, match, scans
from cardvision.db.pool import close_pool, init_pool
from cardvision.storage.client import ensure_bucket


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    ensure_bucket()
    yield
    await close_pool()


def create_app() -> FastAPI:
    app = FastAPI(
        title="CardVision",
        description="Standalone card photo-matching / provenance service — "
        "photo-matched, not authenticated. See apps/cardvision.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(health.router)
    app.include_router(scans.router)
    app.include_router(match.router)
    app.include_router(cards.router)
    return app


app = create_app()
