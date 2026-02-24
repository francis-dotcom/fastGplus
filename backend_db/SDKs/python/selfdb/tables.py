"""SelfDB SDK Tables Module - Table management and data operations."""

from dataclasses import asdict
from typing import Any, Dict, List, Optional, TYPE_CHECKING

from selfdb.http_client import HTTPClient
from selfdb.models import (
    TableCreate,
    TableUpdate,
    TableRead,
    TableDataResponse,
    TableDeleteResponse,
    RowDeleteResponse,
    ColumnDefinition,
    ColumnUpdate,
    table_from_dict,
)


class TableDataQueryBuilder:
    """
    Fluent query builder for table data queries.
    
    Provides a chainable interface for constructing queries
    that map directly to GET /tables/{table_id}/data endpoint parameters.
    """

    def __init__(self, http: HTTPClient, table_id: str):
        self._http = http
        self._table_id = table_id
        self._search_term: Optional[str] = None
        self._sort_by: Optional[str] = None
        self._sort_order: Optional[str] = None
        self._page_num: int = 1
        self._page_size_val: int = 100

    def search(self, term: str) -> "TableDataQueryBuilder":
        """Filter: ILIKE search across text columns."""
        new_builder = TableDataQueryBuilder(self._http, self._table_id)
        new_builder._search_term = term
        new_builder._sort_by = self._sort_by
        new_builder._sort_order = self._sort_order
        new_builder._page_num = self._page_num
        new_builder._page_size_val = self._page_size_val
        return new_builder

    def sort(self, column: str, order: str = "desc") -> "TableDataQueryBuilder":
        """Sort by column (asc/desc)."""
        new_builder = TableDataQueryBuilder(self._http, self._table_id)
        new_builder._search_term = self._search_term
        new_builder._sort_by = column
        new_builder._sort_order = order
        new_builder._page_num = self._page_num
        new_builder._page_size_val = self._page_size_val
        return new_builder

    def page(self, page_num: int) -> "TableDataQueryBuilder":
        """Set page number (1-indexed)."""
        new_builder = TableDataQueryBuilder(self._http, self._table_id)
        new_builder._search_term = self._search_term
        new_builder._sort_by = self._sort_by
        new_builder._sort_order = self._sort_order
        new_builder._page_num = page_num
        new_builder._page_size_val = self._page_size_val
        return new_builder

    def page_size(self, size: int) -> "TableDataQueryBuilder":
        """Set results per page (1-1000)."""
        new_builder = TableDataQueryBuilder(self._http, self._table_id)
        new_builder._search_term = self._search_term
        new_builder._sort_by = self._sort_by
        new_builder._sort_order = self._sort_order
        new_builder._page_num = self._page_num
        new_builder._page_size_val = size
        return new_builder

    async def execute(self) -> TableDataResponse:
        """Execute query and return TableDataResponse."""
        params = {
            "page": self._page_num,
            "page_size": self._page_size_val,
            "search": self._search_term,
            "sort_by": self._sort_by,
            "sort_order": self._sort_order,
        }
        response = await self._http.get(
            f"/tables/{self._table_id}/data",
            params=params,
            authenticated=True,
        )
        return TableDataResponse(
            data=response.get("data", []),
            total=response.get("total", 0),
            page=response.get("page", 1),
            page_size=response.get("page_size", 100),
        )


class TableDataResource:
    """Table data operations sub-resource."""

    def __init__(self, http: HTTPClient):
        self._http = http

    def query(self, table_id: str) -> TableDataQueryBuilder:
        """Create a query builder for the table."""
        return TableDataQueryBuilder(self._http, table_id)

    async def fetch(
        self,
        table_id: str,
        *,
        page: int = 1,
        page_size: int = 100,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = None,
    ) -> TableDataResponse:
        """
        Fetch paginated data from a table.
        GET /tables/{table_id}/data
        """
        params = {
            "page": page,
            "page_size": page_size,
            "search": search,
            "sort_by": sort_by,
            "sort_order": sort_order,
        }
        response = await self._http.get(
            f"/tables/{table_id}/data",
            params=params,
            authenticated=True,
        )
        return TableDataResponse(
            data=response.get("data", []),
            total=response.get("total", 0),
            page=response.get("page", 1),
            page_size=response.get("page_size", 100),
        )

    async def insert(self, table_id: str, row_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Insert a new row into the table.
        POST /tables/{table_id}/data
        """
        response = await self._http.post(
            f"/tables/{table_id}/data",
            json=row_data,
            authenticated=True,
        )
        return response

    async def update_row(
        self,
        table_id: str,
        row_id: str,
        updates: Dict[str, Any],
        *,
        id_column: str = "id",
    ) -> Dict[str, Any]:
        """
        Update a row in the table.
        PATCH /tables/{table_id}/data/{row_id}
        """
        params = {"id_column": id_column}
        response = await self._http.patch(
            f"/tables/{table_id}/data/{row_id}",
            json=updates,
            params=params,
            authenticated=True,
        )
        return response

    async def delete_row(
        self,
        table_id: str,
        row_id: str,
        *,
        id_column: str = "id",
    ) -> RowDeleteResponse:
        """
        Delete a row from the table.
        DELETE /tables/{table_id}/data/{row_id}
        """
        params = {"id_column": id_column}
        response = await self._http.delete(
            f"/tables/{table_id}/data/{row_id}",
            params=params,
            authenticated=True,
        )
        return RowDeleteResponse(
            message=response.get("message", "Row deleted"),
            deleted_id=response.get("deleted_id", row_id),
        )


class TableColumnsResource:
    """Table columns operations sub-resource."""

    def __init__(self, http: HTTPClient):
        self._http = http

    async def add(self, table_id: str, column: ColumnDefinition) -> TableRead:
        """
        Add a new column to an existing table.
        POST /tables/{table_id}/columns
        """
        data = {k: v for k, v in asdict(column).items() if v is not None}
        response = await self._http.post(
            f"/tables/{table_id}/columns",
            json=data,
            authenticated=True,
        )
        return table_from_dict(response)

    async def update(
        self,
        table_id: str,
        column_name: str,
        updates: ColumnUpdate,
    ) -> TableRead:
        """
        Update column properties.
        PATCH /tables/{table_id}/columns/{column_name}
        """
        data = {k: v for k, v in asdict(updates).items() if v is not None}
        response = await self._http.patch(
            f"/tables/{table_id}/columns/{column_name}",
            json=data,
            authenticated=True,
        )
        return table_from_dict(response)

    async def remove(self, table_id: str, column_name: str) -> TableRead:
        """
        Delete a column from a table.
        DELETE /tables/{table_id}/columns/{column_name}
        """
        response = await self._http.delete(
            f"/tables/{table_id}/columns/{column_name}",
            authenticated=True,
        )
        return table_from_dict(response)


class TablesClient:
    """Tables client for SelfDB."""

    def __init__(self, http: HTTPClient):
        self._http = http
        self.columns = TableColumnsResource(http)
        self.data = TableDataResource(http)

    async def count(self, search: Optional[str] = None) -> int:
        """Get total number of tables. GET /tables/count"""
        params = {"search": search} if search else None
        response = await self._http.get("/tables/count", params=params, authenticated=True)
        return response.get("count", 0)

    async def create(self, payload: TableCreate) -> TableRead:
        """Create a new table. POST /tables/"""
        data = {k: v for k, v in asdict(payload).items() if v is not None}
        response = await self._http.post("/tables/", json=data, authenticated=True)
        return table_from_dict(response)

    async def list(
        self,
        *,
        skip: int = 0,
        limit: int = 100,
        search: Optional[str] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = None,
    ) -> List[TableRead]:
        """List tables with optional search and sorting. GET /tables/"""
        params = {
            "skip": skip,
            "limit": limit,
            "search": search,
            "sort_by": sort_by,
            "sort_order": sort_order,
        }
        response = await self._http.get("/tables/", params=params, authenticated=True)
        return [table_from_dict(t) for t in response]

    async def get(self, table_id: str) -> TableRead:
        """Get a table by ID. GET /tables/{table_id}"""
        response = await self._http.get(f"/tables/{table_id}", authenticated=True)
        return table_from_dict(response)

    async def update(self, table_id: str, payload: TableUpdate) -> TableRead:
        """Update a table. PATCH /tables/{table_id}"""
        data = {k: v for k, v in asdict(payload).items() if v is not None}
        response = await self._http.patch(f"/tables/{table_id}", json=data, authenticated=True)
        return table_from_dict(response)

    async def delete(self, table_id: str) -> TableDeleteResponse:
        """Delete a table. DELETE /tables/{table_id}"""
        response = await self._http.delete(f"/tables/{table_id}", authenticated=True)
        return TableDeleteResponse(
            message=response.get("message", "Table deleted"),
            deleted_id=response.get("deleted_id", table_id),
        )
