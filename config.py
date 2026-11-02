import os

from dotenv import load_dotenv

load_dotenv()


def _cors_origins(default):
    configured = os.getenv("CORS_ALLOWED_ORIGINS")
    if not configured:
        return default
    return [origin.strip() for origin in configured.split(",") if origin.strip()]


class BaseConfig:
    APP_ENV = os.getenv("APP_ENV", "development").lower()
    SECRET_KEY = os.getenv("SECRET_KEY")
    SQLALCHEMY_DATABASE_URI = os.getenv("DATABASE_URL", "sqlite:///crypt.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    MAX_CONTENT_LENGTH = 2 * 1024 * 1024
    DEBUG = False


class DevelopmentConfig(BaseConfig):
    SECRET_KEY = BaseConfig.SECRET_KEY or "dev-only-change-me"
    DEBUG = True
    SESSION_COOKIE_SECURE = False
    CORS_ORIGINS = _cors_origins(
        ["http://localhost:5173", "http://127.0.0.1:5173"]
    )


class ProductionConfig(BaseConfig):
    SESSION_COOKIE_SECURE = True
    CORS_ORIGINS = _cors_origins([])


CONFIGS = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}
