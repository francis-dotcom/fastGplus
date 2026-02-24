/**
 * SelfDB SDK Error Classes
 * 
 * Error hierarchy for handling API errors in a structured way.
 */

/**
 * Base error class for all SelfDB SDK errors
 */
export class SelfDBError extends Error {
    public readonly status?: number;
    public readonly code?: string;
    public readonly details?: unknown;

    constructor(message: string, status?: number, code?: string, details?: unknown) {
        super(message);
        this.name = 'SelfDBError';
        this.status = status;
        this.code = code;
        this.details = details;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/**
 * Network failures and connection issues
 */
export class APIConnectionError extends SelfDBError {
    constructor(message: string = 'Failed to connect to the API', details?: unknown) {
        super(message, undefined, 'CONNECTION_ERROR', details);
        this.name = 'APIConnectionError';
    }
}

/**
 * 400 Bad Request - Invalid request parameters
 */
export class BadRequestError extends SelfDBError {
    constructor(message: string = 'Bad request', details?: unknown) {
        super(message, 400, 'BAD_REQUEST', details);
        this.name = 'BadRequestError';
    }
}

/**
 * 401 Unauthorized - Authentication required or invalid credentials
 */
export class AuthenticationError extends SelfDBError {
    constructor(message: string = 'Authentication required', details?: unknown) {
        super(message, 401, 'AUTHENTICATION_ERROR', details);
        this.name = 'AuthenticationError';
    }
}

/**
 * 403 Forbidden - Insufficient permissions
 */
export class PermissionDeniedError extends SelfDBError {
    constructor(message: string = 'Permission denied', details?: unknown) {
        super(message, 403, 'PERMISSION_DENIED', details);
        this.name = 'PermissionDeniedError';
    }
}

/**
 * 404 Not Found - Resource not found
 */
export class NotFoundError extends SelfDBError {
    constructor(message: string = 'Resource not found', details?: unknown) {
        super(message, 404, 'NOT_FOUND', details);
        this.name = 'NotFoundError';
    }
}

/**
 * 409 Conflict - Resource conflict
 */
export class ConflictError extends SelfDBError {
    constructor(message: string = 'Resource conflict', details?: unknown) {
        super(message, 409, 'CONFLICT', details);
        this.name = 'ConflictError';
    }
}

/**
 * 500 Internal Server Error
 */
export class InternalServerError extends SelfDBError {
    constructor(message: string = 'Internal server error', details?: unknown) {
        super(message, 500, 'INTERNAL_SERVER_ERROR', details);
        this.name = 'InternalServerError';
    }
}
