import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from contextlib import asynccontextmanager
from engine.inference_engine import InferenceEngine as LikInferenceEngine
import sqlite3
import json

DB_PATH = os.getenv("DB_PATH", "/app/data/disaster.db")

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.db_path = DB_PATH
    yield

app = FastAPI(title="LIK Inference Engine API", version="1.0.0")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "lik-inference-engine"}

from pydantic import BaseModel
from typing import Optional

class PredictRequest(BaseModel):
    lik_codes: list[str]
    beach_location: str
    is_active_warning: bool = False
    active_warning: list[str] = []
    beach_id: Optional[int] = None
    beach_name: Optional[str] = None
    reported_codes: Optional[list[str]] = None
    bmkg_wind_speed: Optional[float] = None
    bmkg_wave_height: Optional[float] = None
    bmkg_rainfall: Optional[float] = None

BEACH_MAP = {
    "pantai_lampuuk": 1,
    "pantai_lhoknga": 2,
    "pantai_ulee_lheue": 3,
    "pantai_depok": 4,
    "pantai_samas": 5,
}

@app.post("/predict")
async def predict(req: PredictRequest):
    if req.beach_location not in BEACH_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported beach_location. Supported beaches: {', '.join(BEACH_MAP)}",
        )

    codes = req.reported_codes if req.reported_codes else req.lik_codes
    bid = req.beach_id if req.beach_id else BEACH_MAP.get(req.beach_location, 0)
    bname = req.beach_name if req.beach_name else req.beach_location

    engine = LikInferenceEngine()
    # Select the server-owned community profile using the backend's beach slug.
    rules_by_beach = {
        "pantai_lampuuk": engine.pantai_lampuuk_rules,
        "pantai_lhoknga": engine.pantai_lhoknga_rules,
        "pantai_ulee_lheue": engine.pantai_ulee_lheue_rules,
        "pantai_depok": engine.pantai_depok_rules,
        "pantai_samas": engine.pantai_samas_rules,
    }
    result = engine.predict({
        "lik_codes": codes,
        "active_warning": req.active_warning,
        "beach_id": bid,
        "beach_name": bname,
        "rules": rules_by_beach[req.beach_location],
    })
    return result
