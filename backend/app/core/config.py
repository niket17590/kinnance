from pydantic_settings import BaseSettings
from functools import lru_cache
from dotenv import load_dotenv
import os

# Load base .env first, then environment-specific override
load_dotenv(".env")
_env = os.getenv("APP_ENV", "development")
load_dotenv(f".env.{_env}", override=True)

class Settings(BaseSettings):
    # App
    APP_NAME: str = "Kinnance"
    APP_ENV: str = "development"

    # Database
    DATABASE_URL: str

    # Supabase
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_KEY: str

    # JWT
    SECRET_KEY: str
    ALGORITHM: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int

    # Twelve Data
    TWELVEDATA_API_KEY: str

    # Super Admin
    SUPER_ADMIN_EMAIL: str

    class Config:
        case_sensitive = True
        env_file_encoding = "utf-8"

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()