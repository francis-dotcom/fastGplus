/**
 * SelfDB SDK Tables Module
 * 
 * Table management, columns, and data operations with query builder.
 */

import { HttpClient } from './client';
import {
    TableCreate,
    TableUpdate,
    TableRead,
    TableDataResponse,
    TableDeleteResponse,
    RowDeleteResponse,
    ColumnDefinition,
    ColumnUpdate,
    CountResponse,
    PaginationOptions,
    SortOrder,
} from './models';

/**
 * Query builder options
 */
interface QueryOptions {
    search?: string;
    sortBy?: string;
    sortOrder?: SortOrder;
    page?: number;
    pageSize?: number;
}

/**
 * Query Builder for fluent table data queries
 */
export class TableQueryBuilder {
    private options: QueryOptions = {};

    constructor(
        private client: HttpClient,
        private tableId: string
    ) {}

    /**
     * Add search filter
     */
    search(term: string): TableQueryBuilder {
        const builder = new TableQueryBuilder(this.client, this.tableId);
        builder.options = { ...this.options, search: term };
        return builder;
    }

    /**
     * Add sort options
     */
    sort(column: string, order: SortOrder = 'desc'): TableQueryBuilder {
        const builder = new TableQueryBuilder(this.client, this.tableId);
        builder.options = { ...this.options, sortBy: column, sortOrder: order };
        return builder;
    }

    /**
     * Set page number (1-indexed)
     */
    page(pageNumber: number): TableQueryBuilder {
        const builder = new TableQueryBuilder(this.client, this.tableId);
        builder.options = { ...this.options, page: pageNumber };
        return builder;
    }

    /**
     * Set page size (1-1000)
     */
    pageSize(size: number): TableQueryBuilder {
        const builder = new TableQueryBuilder(this.client, this.tableId);
        builder.options = { ...this.options, pageSize: size };
        return builder;
    }

    /**
     * Execute the query
     */
    async execute(): Promise<TableDataResponse> {
        const query: Record<string, string | number | boolean | undefined> = {
            page: this.options.page,
            page_size: this.options.pageSize,
            search: this.options.search,
            sort_by: this.options.sortBy,
            sort_order: this.options.sortOrder,
        };
        return this.client.get<TableDataResponse>(`/tables/${this.tableId}/data`, query);
    }
}

/**
 * Columns resource for table column operations
 */
export class ColumnsResource {
    constructor(private client: HttpClient) {}

    /**
     * Add a column to a table
     * POST /tables/{table_id}/columns
     */
    async add(tableId: string, column: ColumnDefinition): Promise<TableRead> {
        return this.client.post<TableRead>(`/tables/${tableId}/columns`, column);
    }

    /**
     * Update a column
     * PATCH /tables/{table_id}/columns/{column_name}
     */
    async update(tableId: string, columnName: string, updates: ColumnUpdate): Promise<TableRead> {
        return this.client.patch<TableRead>(`/tables/${tableId}/columns/${columnName}`, updates);
    }

    /**
     * Remove a column from a table
     * DELETE /tables/{table_id}/columns/{column_name}
     */
    async remove(tableId: string, columnName: string): Promise<TableRead> {
        return this.client.delete<TableRead>(`/tables/${tableId}/columns/${columnName}`);
    }
}

/**
 * Table data resource for row operations
 */
export class TableDataResource {
    constructor(private client: HttpClient) {}

    /**
     * Create a query builder for fluent queries
     */
    query(tableId: string): TableQueryBuilder {
        return new TableQueryBuilder(this.client, tableId);
    }

    /**
     * Fetch table data with options
     * GET /tables/{table_id}/data
     */
    async fetch(
        tableId: string,
        options: {
            page?: number;
            pageSize?: number;
            search?: string;
            sortBy?: string;
            sortOrder?: SortOrder;
        } = {}
    ): Promise<TableDataResponse> {
        const query: Record<string, string | number | boolean | undefined> = {
            page: options.page,
            page_size: options.pageSize,
            search: options.search,
            sort_by: options.sortBy,
            sort_order: options.sortOrder,
        };
        return this.client.get<TableDataResponse>(`/tables/${tableId}/data`, query);
    }

    /**
     * Insert a row into a table
     * POST /tables/{table_id}/data
     */
    async insert(tableId: string, row: Record<string, unknown>): Promise<Record<string, unknown>> {
        return this.client.post<Record<string, unknown>>(`/tables/${tableId}/data`, row);
    }

    /**
     * Update a row in a table
     * PATCH /tables/{table_id}/data/{row_id}
     */
    async updateRow(
        tableId: string,
        rowId: string,
        updates: Record<string, unknown>,
        options: { idColumn?: string } = {}
    ): Promise<Record<string, unknown>> {
        const query = options.idColumn ? { id_column: options.idColumn } : undefined;
        return this.client.patch<Record<string, unknown>>(`/tables/${tableId}/data/${rowId}`, updates, query);
    }

    /**
     * Delete a row from a table
     * DELETE /tables/{table_id}/data/{row_id}
     */
    async deleteRow(
        tableId: string,
        rowId: string,
        options: { idColumn?: string } = {}
    ): Promise<RowDeleteResponse> {
        const query = options.idColumn ? { id_column: options.idColumn } : undefined;
        return this.client.delete<RowDeleteResponse>(`/tables/${tableId}/data/${rowId}`, query);
    }
}

/**
 * Tables module for table management
 */
export class Tables {
    public readonly columns: ColumnsResource;
    public readonly data: TableDataResource;

    constructor(private client: HttpClient) {
        this.columns = new ColumnsResource(client);
        this.data = new TableDataResource(client);
    }

    /**
     * Get table count
     * GET /tables/count
     */
    async count(options: { search?: string } = {}): Promise<CountResponse> {
        const query = options.search ? { search: options.search } : undefined;
        return this.client.get<CountResponse>('/tables/count', query);
    }

    /**
     * Create a table
     * POST /tables/
     */
    async create(table: TableCreate): Promise<TableRead> {
        return this.client.post<TableRead>('/tables/', table);
    }

    /**
     * List tables with optional pagination and search
     * GET /tables/
     */
    async list(options: PaginationOptions = {}): Promise<TableRead[]> {
        const query: Record<string, string | number | boolean | undefined> = {
            skip: options.skip,
            limit: options.limit,
            search: options.search,
            sort_by: options.sortBy,
            sort_order: options.sortOrder,
        };
        return this.client.get<TableRead[]>('/tables/', query);
    }

    /**
     * Get a table by ID
     * GET /tables/{table_id}
     */
    async get(tableId: string): Promise<TableRead> {
        return this.client.get<TableRead>(`/tables/${tableId}`);
    }

    /**
     * Update a table
     * PATCH /tables/{table_id}
     */
    async update(tableId: string, updates: TableUpdate): Promise<TableRead> {
        return this.client.patch<TableRead>(`/tables/${tableId}`, updates);
    }

    /**
     * Delete a table
     * DELETE /tables/{table_id}
     */
    async delete(tableId: string): Promise<TableDeleteResponse> {
        return this.client.delete<TableDeleteResponse>(`/tables/${tableId}`);
    }
}
