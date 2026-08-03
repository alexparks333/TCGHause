"""FastAPI app entrypoint. Run from apps/cardvision/: `uv run python cmd/serve.py`."""

import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn  # noqa: E402

from cardvision.app import app  # noqa: E402
from cardvision.config import settings  # noqa: E402

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=settings.port)
