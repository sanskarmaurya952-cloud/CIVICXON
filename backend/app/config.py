from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    DATABASE_URL: str = "sqlite:///./civicxon.db"
    JWT_SECRET: str = "dev-only-insecure-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_TTL_MINUTES: int = 480
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
    UPLOAD_DIR: str = "./uploads"
    STORAGE_BACKEND: str = "local"
    S3_BUCKET: str = ""
    S3_REGION: str = ""
    S3_ENDPOINT_URL: str = ""
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    GEMMA_API_KEY: str = ""
    GEMMA_MODEL: str = "gemma-4-26b-a4b-it"
    GEMMA_ENDPOINT: str = "https://generativelanguage.googleapis.com/v1beta"
    AUTO_ASSIGN: bool = True
    ALLOCATION_WEIGHTS: str = '{"skill":45,"distance":25,"workload":20,"availability":10}'


settings = Settings()
