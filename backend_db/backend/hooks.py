# hooks.py
"""
Schemathesis hooks for backend API testing.

This module provides:
1. Custom deserializers for content types that schemathesis doesn't handle by default
2. Hooks for modifying test data generation

Usage via schemathesis.toml:
    hooks = "hooks"
"""

import schemathesis


# ─────────────────────────────────────────────────────────────────────────────
# DESERIALIZERS
# Register deserializers for content types that schemathesis doesn't
# handle by default. This enables schema validation for various responses.
# ─────────────────────────────────────────────────────────────────────────────

@schemathesis.deserializer("application/gzip")
def deserialize_gzip(ctx: schemathesis.DeserializationContext, response):
    """
    Deserialize application/gzip responses.
    
    For gzip compressed content (like backup downloads), we return
    as a base64 encoded string since the content is binary.
    """
    import base64
    try:
        return base64.b64encode(response.content).decode("ascii")
    except Exception:
        return response.content


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


@schemathesis.deserializer("text/html")
def deserialize_text_html(ctx: schemathesis.DeserializationContext, response):
    """
    Deserialize text/html responses.
    
    Returns the decoded HTML content.
    """
    try:
        return response.content.decode(response.encoding or "utf-8")
    except (UnicodeDecodeError, AttributeError):
        return response.content.decode("latin-1")


@schemathesis.deserializer("application/sql")
def deserialize_sql(ctx: schemathesis.DeserializationContext, response):
    """
    Deserialize application/sql responses.
    
    Returns the decoded SQL content for backup files.
    """
    try:
        return response.content.decode("utf-8")
    except (UnicodeDecodeError, AttributeError):
        return response.content.decode("latin-1")
