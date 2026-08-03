from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql://localhost:5432/cardvision"

    s3_endpoint_url: str = "http://localhost:9000"
    # Separate from s3_endpoint_url on purpose: the service itself always
    # talks to MinIO over localhost (same machine), but URLs handed back to
    # clients (a phone on the LAN, say) need a real routable address — and
    # on networks without NAT hairpinning, a machine can't reach itself via
    # its own LAN-facing IP, so these two can't just be the same value.
    # Defaults to s3_endpoint_url when unset.
    s3_public_url: str | None = None
    s3_access_key: str = "cardvision"
    s3_secret_key: str = "cardvision123"
    s3_bucket: str = "cardvision-scans"
    s3_region: str = "us-east-1"

    port: int = 8090


settings = Settings()
