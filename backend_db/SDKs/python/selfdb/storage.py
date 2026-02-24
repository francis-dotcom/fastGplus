"""SelfDB SDK Storage Module - Bucket and file management."""

from dataclasses import asdict
from typing import Any, BinaryIO, Dict, List, Optional, Union

from selfdb.http_client import HTTPClient
from selfdb.models import (
    BucketCreate,
    BucketUpdate,
    BucketResponse,
    FileResponse,
    FileUploadResponse,
    FileDataResponse,
    StorageStatsResponse,
    bucket_from_dict,
    file_from_dict,
)


class BucketsResource:
    """Storage buckets sub-resource."""

    def __init__(self, http: HTTPClient):
        self._http = http

    async def count(self, search: Optional[str] = None) -> int:
        """Get total number of buckets. GET /storage/buckets/count"""
        params = {"search": search} if search else None
        response = await self._http.get(
            "/storage/buckets/count",
            params=params,
            authenticated=True,
        )
        return response.get("count", 0)

    async def create(self, payload: BucketCreate) -> BucketResponse:
        """Create a new bucket. POST /storage/buckets/"""
        data = {k: v for k, v in asdict(payload).items() if v is not None}
        response = await self._http.post(
            "/storage/buckets/",
            json=data,
            authenticated=True,
        )
        return bucket_from_dict(response)

    async def list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = None,
    ) -> List[BucketResponse]:
        """List buckets with optional search and sorting. GET /storage/buckets/"""
        params = {
            "skip": skip,
            "limit": limit,
            "search": search,
            "sort_by": sort_by,
            "sort_order": sort_order,
        }
        response = await self._http.get(
            "/storage/buckets/",
            params=params,
            authenticated=True,
        )
        return [bucket_from_dict(b) for b in response]

    async def get(self, bucket_id: str) -> BucketResponse:
        """Get a bucket by ID. GET /storage/buckets/{bucket_id}"""
        response = await self._http.get(
            f"/storage/buckets/{bucket_id}",
            authenticated=True,
        )
        return bucket_from_dict(response)

    async def update(self, bucket_id: str, payload: BucketUpdate) -> BucketResponse:
        """Update a bucket. PATCH /storage/buckets/{bucket_id}"""
        data = {k: v for k, v in asdict(payload).items() if v is not None}
        response = await self._http.patch(
            f"/storage/buckets/{bucket_id}",
            json=data,
            authenticated=True,
        )
        return bucket_from_dict(response)

    async def delete(self, bucket_id: str) -> Dict[str, Any]:
        """Delete a bucket. DELETE /storage/buckets/{bucket_id}"""
        response = await self._http.request(
            "DELETE",
            f"/storage/buckets/{bucket_id}",
            authenticated=True,
        )
        # Handle empty response (204 No Content)
        if response.status_code == 204 or not response.content:
            return {"message": "Bucket deleted", "deleted_id": bucket_id}
        return response.json()


class FilesResource:
    """Storage files sub-resource."""

    def __init__(self, http: HTTPClient):
        self._http = http

    async def stats(self) -> StorageStatsResponse:
        """Get storage statistics. GET /storage/files/stats"""
        response = await self._http.get(
            "/storage/files/stats",
            authenticated=True,
        )
        return StorageStatsResponse(
            total_files=response.get("total_files", 0),
            total_size=response.get("total_size", 0),
            total_buckets=response.get("total_buckets", 0),
        )

    async def total_count(self, search: Optional[str] = None) -> int:
        """Get total number of files across all buckets. GET /storage/files/total-count"""
        params = {"search": search} if search else None
        response = await self._http.get(
            "/storage/files/total-count",
            params=params,
            authenticated=True,
        )
        return response.get("count", 0)

    async def count(
        self,
        bucket_id: str,
        *,
        search: Optional[str] = None,
    ) -> int:
        """Get file count for a specific bucket. GET /storage/files/count"""
        params = {"bucket_id": bucket_id, "search": search}
        response = await self._http.get(
            "/storage/files/count",
            params=params,
            authenticated=True,
        )
        return response.get("count", 0)

    async def upload(
        self,
        bucket_id: str,
        filename: str,
        data: Union[bytes, BinaryIO],
        *,
        path: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> FileUploadResponse:
        """
        Upload a file to a bucket. POST /storage/files/upload
        
        Args:
            bucket_id: The bucket ID to upload to
            filename: The name of the file
            data: File content as bytes or file-like object
            path: Optional path within the bucket
            content_type: Optional MIME type
        """
        # Prepare file data
        if isinstance(data, bytes):
            file_content = data
        else:
            file_content = data.read()
        
        # Prepare query params
        params = {
            "bucket_id": bucket_id,
            "filename": filename,
            "path": path,
            "content_type": content_type or "application/octet-stream",
        }
        
        # Send raw body with query params
        client = await self._http._get_client()
        headers = self._http._build_headers(authenticated=True)
        headers["Content-Type"] = content_type or "application/octet-stream"
        
        # Filter out None values from params
        params = {k: v for k, v in params.items() if v is not None}
        
        try:
            response = await client.post(
                "/storage/files/upload",
                params=params,
                content=file_content,
                headers=headers,
            )
        except Exception as e:
            from selfdb.exceptions import APIConnectionError
            raise APIConnectionError(f"Upload failed: {e}")
        
        if response.status_code >= 400:
            self._http._handle_error(response)
        
        result = response.json()
        return FileUploadResponse(
            success=result.get("success", True),
            bucket=result["bucket"],
            path=result["path"],
            size=result["size"],
            file_id=result.get("file_id"),
            upload_time=result.get("upload_time"),
            url=result.get("url"),
            original_path=result.get("original_path"),
            message=result.get("message"),
        )

    async def list(
        self,
        *,
        bucket_id: Optional[str] = None,
        page: int = 1,
        page_size: int = 100,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = None,
    ) -> FileDataResponse:
        """List files with optional filters. GET /storage/files/"""
        params = {
            "bucket_id": bucket_id,
            "page": page,
            "page_size": page_size,
            "search": search,
            "sort_by": sort_by,
            "sort_order": sort_order,
        }
        response = await self._http.get(
            "/storage/files/",
            params=params,
            authenticated=True,
        )
        return FileDataResponse(
            data=[file_from_dict(f) for f in response.get("data", [])],
            total=response.get("total", 0),
            page=response.get("page", 1),
            page_size=response.get("page_size", 100),
        )

    async def get(self, file_id: str) -> FileResponse:
        """Get a file by ID. GET /storage/files/{file_id}"""
        response = await self._http.get(
            f"/storage/files/{file_id}",
            authenticated=True,
        )
        return file_from_dict(response)

    async def delete(self, file_id: str) -> Dict[str, Any]:
        """Delete a file. DELETE /storage/files/{file_id}"""
        response = await self._http.request(
            "DELETE",
            f"/storage/files/{file_id}",
            authenticated=True,
        )
        # Handle empty response (204 No Content)
        if response.status_code == 204 or not response.content:
            return {"message": "File deleted", "deleted_id": file_id}
        return response.json()

    async def update_metadata(
        self,
        file_id: str,
        metadata: Dict[str, Any],
    ) -> FileResponse:
        """Update file metadata. PATCH /storage/files/{file_id}"""
        response = await self._http.patch(
            f"/storage/files/{file_id}",
            json={"metadata": metadata},
            authenticated=True,
        )
        return file_from_dict(response)

    async def download(
        self,
        bucket_name: str,
        path: str,
    ) -> bytes:
        """
        Download a file. GET /storage/files/download/{bucket_name}/{path}
        
        Returns the raw file content as bytes.
        """
        return await self._http.get_raw(
            f"/storage/files/download/{bucket_name}/{path}",
            authenticated=True,
        )


class StorageClient:
    """Storage client for SelfDB."""

    def __init__(self, http: HTTPClient):
        self._http = http
        self.buckets = BucketsResource(http)
        self.files = FilesResource(http)
