from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from endpoints.buckets import router as buckets_router
from endpoints.files import router as files_router
from db import init_db, close_db, is_db_configured


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan - initialize and cleanup resources."""
    # Startup
    try:
        await init_db()
    except Exception as e:
        # Log but don't fail - storage can work without DB for blob-only mode
        print(f"Database connection not available: {e}")
    
    yield
    
    # Shutdown
    await close_db()


app = FastAPI(
    title="SelfDB Storage",
    version="0.5.0",
    lifespan=lifespan
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Validation error"}
    )

app.include_router(buckets_router, prefix="/api/v1")
app.include_router(files_router, prefix="/api/v1")

@app.get("/health")
def health():
    return {
        "status": "healthy",
        "database": "connected" if is_db_configured() else "not configured"
    }
