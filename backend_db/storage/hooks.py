# hooks.py
"""
Schemathesis hooks for storage service API testing.

This module provides:
1. Custom deserializers for binary content types (application/octet-stream, text/plain)

Usage via schemathesis.toml:
    hooks = "hooks"
"""

import schemathesis


# ─────────────────────────────────────────────────────────────────────────────
# DESERIALIZERS
# Register deserializers for binary content types that schemathesis doesn't
# handle by default. This enables schema validation for file download responses.
# ─────────────────────────────────────────────────────────────────────────────

@schemathesis.deserializer("application/octet-stream")
def deserialize_octet_stream(ctx: schemathesis.DeserializationContext, response):
    """
    Deserialize application/octet-stream responses.
    
    For binary content, we return as a string (base64 or decoded)
    since OpenAPI schema expects 'type: string, format: binary'.
    """
    try:
        # Try to decode as text first
        return response.content.decode("utf-8")
    except (UnicodeDecodeError, AttributeError):
        # For true binary data, return as base64 encoded string
        import base64
        return base64.b64encode(response.content).decode("ascii")


@schemathesis.deserializer("text/plain")
def deserialize_text_plain(ctx: schemathesis.DeserializationContext, response):
    """
    Deserialize text/plain responses.
    
    Returns the decoded text content for text-based file responses.
    """
    try:
        return response.content.decode(response.encoding or "utf-8")
    except (UnicodeDecodeError, AttributeError):
        return response.content.decode("latin-1")
