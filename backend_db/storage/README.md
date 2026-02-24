# SelfDB Storage Service

Internal blob storage service for SelfDB. Provides S3-compatible bucket and file operations with streaming uploads/downloads.

**Version:** 0.5.0

## Features

- **Bucket Management** - Create, list, get, update, delete buckets with S3-style naming
- **File Operations** - Upload, download, delete files with nested path support
- **Streaming I/O** - 64KB chunked uploads, streaming downloads via `FileResponse`
- **Multi-Worker Safe** - Atomic file writes, idempotent operations, race-condition handling
- **Unlimited File Size** - No file size limits (tested with 1.34 GB files)
- **Path Traversal Protection** - Secure path joining prevents directory escape

## Quick Start

### Development

```bash
# Start development server (single worker, auto-reload)
uv run fastapi dev

# Start with multiple workers (production-like)
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
```

Visit http://localhost:8000/docs for interactive API documentation.

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `STORAGE_PATH` | `./data` | Base directory for blob storage |

## API Reference

Base URL: `http://localhost:8000/api/v1`

### Health Check

```
GET /health
```

### Buckets

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/buckets` | Create bucket |
| `GET` | `/buckets` | List all buckets |
| `GET` | `/buckets/{bucket}` | Get bucket details |
| `PATCH` | `/buckets/{bucket}` | Update bucket |
| `DELETE` | `/buckets/{bucket}` | Delete bucket (cascades to files) |

**Bucket naming rules** (S3-compatible):
- 3-63 characters
- Lowercase letters, numbers, hyphens only
- Must start/end with letter or number
- Pattern: `^[a-z0-9][a-z0-9\-]{1,61}[a-z0-9]$`

### Files

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/files/{bucket}/{path}` | Upload file |
| `GET` | `/files/{bucket}/{path}` | Download file |
| `DELETE` | `/files/{bucket}/{path}` | Delete file |

**Path examples:**
- `document.pdf` - File in bucket root
- `images/photo.png` - Nested file
- `data/2024/01/report.csv` - Deeply nested file

## Examples

### Create a bucket

```bash
curl -X POST http://localhost:8000/api/v1/buckets \
  -H "Content-Type: application/json" \
  -d '{"name": "my-bucket", "public": false}'
```

### Upload a file

```bash
curl -X POST http://localhost:8000/api/v1/files/my-bucket/uploads/photo.png \
  -F "file=@photo.png"
```

### Download a file

```bash
curl http://localhost:8000/api/v1/files/my-bucket/uploads/photo.png -o photo.png
```

### Delete a file

```bash
curl -X DELETE http://localhost:8000/api/v1/files/my-bucket/uploads/photo.png
```

### Delete a bucket

```bash
curl -X DELETE http://localhost:8000/api/v1/buckets/my-bucket
```

## Architecture

```
storage/
├── main.py              # FastAPI app entry point
├── endpoints/
│   ├── buckets.py       # Bucket CRUD operations
│   └── files.py         # File upload/download/delete
├── models/
│   ├── bucket.py        # Bucket Pydantic models
│   └── file.py          # File Pydantic models
├── data/                # Default blob storage location
└── benchmarks/
    ├── locustfile.py    # Load testing
    └── test-files/      # Test files for benchmarks
```

## Performance

Benchmarked on Apple M-series Mac with 4 workers:

| Metric | Result |
|--------|--------|
| Upload speed | ~415 MB/s |
| Download speed | ~742 MB/s |
| Download TTFB | < 10ms |

Load test results (20 users, 4 workers, 2.34 GB test files):
- **0.64% error rate** (connection timeouts under extreme load)
- All errors are capacity-related, not bugs

## Testing

### Unit/Integration Tests

```bash
# Run Schemathesis API fuzzing
./run_schemathesis.sh
```

### Load Testing

```bash
cd benchmarks

# Quick smoke test
uv run locust -f locustfile.py --host=http://localhost:8000 \
  --users 10 --spawn-rate 2 --run-time 30s --headless

# Full load test
uv run locust -f locustfile.py --host=http://localhost:8000 \
  --users 50 --spawn-rate 5 --run-time 2m --headless

# Large file stress test
uv run locust -f locustfile.py --host=http://localhost:8000 \
  -u 5 -r 1 --run-time 5m --headless LargeFileUser
```

### Benchmark Script

```bash
./storage_benchmark.sh
```

## Multi-Worker Deployment

The storage service supports multiple uvicorn workers for better throughput:

```bash
# Scale to CPU cores
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --workers $(sysctl -n hw.ncpu)
```

**Multi-worker safety features:**
- Atomic file writes (temp file + `os.replace()`)
- Idempotent bucket creation (`mkdir(exist_ok=True)`)
- Race-condition handling for concurrent deletes
- `FileNotFoundError` handling for list operations

## Design Decisions

### No Server-Side Compression
Like S3, files are stored exactly as uploaded. Reasons:
- Most media files (video, images) are already compressed
- CPU overhead for large files
- Clients can pre-compress with `Content-Encoding: gzip` if needed

### Filesystem-Based Storage
Uses local filesystem for simplicity and portability. For production:
- Mount network storage (NFS, EFS) for shared access
- Or use object storage backend (MinIO, S3)

### No Authentication
This is an internal service. Authentication is handled by the main SelfDB backend which proxies requests to storage.

## License

Part of SelfDB - see root LICENSE.md
