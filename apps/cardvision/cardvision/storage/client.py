"""S3-compatible object storage client — MinIO locally, real S3/R2/Supabase
Storage in production. Bucket creation is idempotent (ensure_bucket) so
`cmd/serve.py` can call it once at startup without a separate provisioning
step.
"""

import uuid

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError

from cardvision.config import settings

# The URL clients (a phone on the LAN, a browser) actually fetch images
# from — separate from settings.s3_endpoint_url, which is what this
# service itself uses to talk to MinIO (see config.py for why these can
# genuinely differ).
_public_base = settings.s3_public_url or settings.s3_endpoint_url

_client = boto3.client(
    "s3",
    endpoint_url=settings.s3_endpoint_url,
    aws_access_key_id=settings.s3_access_key,
    aws_secret_access_key=settings.s3_secret_key,
    region_name=settings.s3_region,
    config=BotoConfig(signature_version="s3v4"),
)


def ensure_bucket() -> None:
    try:
        _client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        _client.create_bucket(Bucket=settings.s3_bucket)


def put_image(data: bytes, *, prefix: str, content_type: str = "image/jpeg") -> tuple[str, str]:
    """Uploads image bytes, returns (object_key, url)."""
    key = f"{prefix}/{uuid.uuid4()}.jpg"
    _client.put_object(Bucket=settings.s3_bucket, Key=key, Body=data, ContentType=content_type)
    url = f"{_public_base}/{settings.s3_bucket}/{key}"
    return key, url


def get_image(key: str) -> bytes:
    obj = _client.get_object(Bucket=settings.s3_bucket, Key=key)
    return obj["Body"].read()


def url_to_key(url: str) -> str:
    """Reverses put_image's URL construction — needed since scans stores
    the URL, but the pipeline needs the key to fetch bytes back."""
    prefix = f"{_public_base}/{settings.s3_bucket}/"
    if not url.startswith(prefix):
        raise ValueError(f"URL {url!r} is not under this service's bucket")
    return url[len(prefix):]
