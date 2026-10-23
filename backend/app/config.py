from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+psycopg2://civicxon:civicxon@localhost:5432/civicxon"
    JWT_SECRET: str = "dev-only-insecure-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_TTL_MINUTES: int = 480
    CORS_ORIGINS: str = "http://localhost:5173"
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

    class Config:
        env_file = ".env"


settings = Settings()
