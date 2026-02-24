"""SelfDB SDK Exception Hierarchy."""

from typing import Any, Optional


class SelfDBError(Exception):
    """Base exception for all SelfDB SDK errors."""

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        response_body: Optional[Any] = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.response_body = response_body

    def __str__(self) -> str:
        if self.status_code:
            return f"[{self.status_code}] {self.message}"
        return self.message


class APIConnectionError(SelfDBError):
    """Raised when the SDK cannot connect to the SelfDB API."""

    def __init__(self, message: str = "Failed to connect to SelfDB API"):
        super().__init__(message)


class BadRequestError(SelfDBError):
    """Raised for 400 Bad Request responses."""

    def __init__(
        self,
        message: str = "Bad request",
        response_body: Optional[Any] = None,
    ):
        super().__init__(message, status_code=400, response_body=response_body)


class AuthenticationError(SelfDBError):
    """Raised for 401 Unauthorized responses."""

    def __init__(
        self,
        message: str = "Authentication failed",
        response_body: Optional[Any] = None,
    ):
        super().__init__(message, status_code=401, response_body=response_body)


class PermissionDeniedError(SelfDBError):
    """Raised for 403 Forbidden responses."""

    def __init__(
        self,
        message: str = "Permission denied",
        response_body: Optional[Any] = None,
    ):
        super().__init__(message, status_code=403, response_body=response_body)


class NotFoundError(SelfDBError):
    """Raised for 404 Not Found responses."""

    def __init__(
        self,
        message: str = "Resource not found",
        response_body: Optional[Any] = None,
    ):
        super().__init__(message, status_code=404, response_body=response_body)


class ConflictError(SelfDBError):
    """Raised for 409 Conflict responses."""

    def __init__(
        self,
        message: str = "Resource conflict",
        response_body: Optional[Any] = None,
    ):
        super().__init__(message, status_code=409, response_body=response_body)


class UnprocessableEntityError(SelfDBError):
    """Raised for 422 Unprocessable Entity responses (validation errors)."""

    def __init__(
        self,
        message: str = "Validation error",
        response_body: Optional[Any] = None,
    ):
        super().__init__(message, status_code=422, response_body=response_body)


class InternalServerError(SelfDBError):
    """Raised for 500 Internal Server Error responses."""

    def __init__(
        self,
        message: str = "Internal server error",
        response_body: Optional[Any] = None,
    ):
        super().__init__(message, status_code=500, response_body=response_body)
