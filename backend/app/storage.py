"""Object storage abstraction.

DEVELOPMENT: LocalStorage writes under UPLOAD_DIR (served by FastAPI StaticFiles).
PRODUCTION: set STORAGE_BACKEND=s3 with S3_BUCKET/REGION/keys — bytes go to
S3/MinIO/R2, only the object key is persisted on Media.storage_key.
"""
import os
import uuid
from pathlib import Path
from .config import settings


class LocalStorage:
    backend = "local"

    def save(self, filename: str, data: bytes, content_type: str) -> str:
        ext = Path(filename).suffix.lower() or ".jpg"
        key = f"{uuid.uuid4().hex}{ext}"
        dest = Path(settings.UPLOAD_DIR) / key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return key

    def url(self, key: str) -> str:
        return f"/media/{key}"

    def delete(self, key: str) -> None:
        try:
            (Path(settings.UPLOAD_DIR) / key).unlink(missing_ok=True)
        except OSError:
            pass


class S3Storage:
    backend = "s3"

    def __init__(self):
        import boto3  # imported lazily — only required when STORAGE_BACKEND=s3

        self.client = boto3.client(
            "s3",
            region_name=settings.S3_REGION or None,
            endpoint_url=settings.S3_ENDPOINT_URL or None,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID or None,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY or None,
        )
        self.bucket = settings.S3_BUCKET

    def save(self, filename: str, data: bytes, content_type: str) -> str:
        ext = Path(filename).suffix.lower() or ".jpg"
        key = f"issues/{uuid.uuid4().hex}{ext}"
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
        return key

    def url(self, key: str) -> str:
        return f"https://{self.bucket}.s3.{settings.S3_REGION}.amazonaws.com/{key}"

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def get_storage():
    if settings.STORAGE_BACKEND == "s3":
        return S3Storage()
    return LocalStorage()


ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
MAX_UPLOAD_BYTES = 6 * 1024 * 1024


def validate_image(filename: str, content_type: str, size: int) -> None:
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValueError(f"Unsupported image type: {content_type}. Allowed: jpeg/png/webp/heic")
    if size > MAX_UPLOAD_BYTES:
        raise ValueError(f"File too large ({size} bytes). Maximum {MAX_UPLOAD_BYTES} bytes.")
    ext = Path(filename).suffix.lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"}:
        raise ValueError("Extension does not match an allowed image type")


def compute_phash(image_bytes: bytes) -> str | None:
    """16x16 aHash (256-bit perceptual hash as 64-char hex string).
    Matches the frontend perceptualHash algorithm in src/lib/config.ts.
    """
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(image_bytes)).convert("L").resize((16, 16), Image.Resampling.LANCZOS)
        pixels = list(img.getdata())
        avg = sum(pixels) / len(pixels)
        bits = "".join("1" if p >= avg else "0" for p in pixels)
        hex_str = "".join(f"{int(bits[i:i+4], 2):x}" for i in range(0, len(bits), 4))
        return hex_str
    except Exception:
        return None
