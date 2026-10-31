import os
from typing import List


class Settings:
    PORT: int = int(os.getenv("PORT", "8000"))
    ENV: str = os.getenv("ENV", "development")
    CORS_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,*").split(",")
        if origin.strip()
    ]
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "none")
    DEFAULT_MERCHANT_ID: str = os.getenv("DEFAULT_MERCHANT_ID", "merch_001")
    MODEL_PATH: str = os.getenv(
        "MODEL_PATH",
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "recovery_model.joblib")
    )


settings = Settings()
