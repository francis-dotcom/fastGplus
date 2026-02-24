import { useState, forwardRef, useImperativeHandle } from 'react';
import type { Ref, ReactElement } from 'react';
import { DataGrid, SelectColumn } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import BulkActionsToolbar from '../BulkActionsToolbar';
import ConfirmationModal from '../ConfirmationModal';
import { ToastContainer } from '../Toast';
import { SearchBar } from './SearchBar';
import { SortControls } from './SortControls';
import { TableHeader } from './TableHeader';
import { useDataTable } from './useDataTable';
import type { DataTableHandle, DataTableProps } from './types';

/**
 * Generic reusable data table component.
 * Supports both "list" mode (infinite scroll) and "detail" mode (page-based pagination).
 */
export const DataTable = forwardRef(function DataTableInner<T extends { id: string }>(
    {
        // Required props
        columns,
        api,
        title,
        entityName,
        sortOptions,
        exportConfig,

        // Optional props with defaults
        rowKeyGetter = (row) => row.id,
        paginationMode = 'infinite',
        pageSize = 50,
        defaultSortBy = sortOptions[0]?.value ?? null,
        defaultSortOrder = 'desc',
        searchPlaceholder = 'Search...',
        searchEnabled = true,
        createButtonLabel,
        renderCreateModal,
        onRowClick,
        headerActions,
        renderSubheader,
        backTo,
        onDownloadSelected,
        totalRows: externalTotalRows,
        rowHeight = 45,
        headerRowHeight = 45,
        gridHeight = 'calc(var(--page-content-height) - 168px)',
        emptyMessage = `No ${entityName}s found`,
        loadingMessage = `Loading ${entityName}s...`,
        rightSidebar,
        showRefreshInline = false,
    }: DataTableProps<T>,
    ref: Ref<DataTableHandle<T>>
) {
    const { theme } = useTheme();
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Use the shared data table hook
    const {
        data,
        setData,
        loading,
        isLoadingMore,
        totalRows: hookTotalRows,
        page,
        setPage,
        selectedRows,
        setSelectedRows,
        isBulkDeleting,
        bulkDeleteConfirm,
        setBulkDeleteConfirm,
        searchQuery,
        sortBy,
        sortOrder,
        setSortBy,
        refresh,
        handleSearchChange,
        clearSearch,
        toggleSortOrder,
        handleScroll,
        handleRowsChange,
        handleBulkDelete,
        handleExportCsv,
        toasts,
        dismissToast,
    } = useDataTable({
        api,
        pageSize,
        defaultSortBy,
        defaultSortOrder,
        entityName,
        exportConfig,
        paginationMode,
    });

    useImperativeHandle(ref, () => ({
        upsertRow: (row: T, opts?: { position?: 'start' | 'end' }) => {
            setData((prev) => {
                const idx = prev.findIndex((r) => r.id === row.id);
                if (idx >= 0) {
                    const next = [...prev];
                    next[idx] = { ...next[idx], ...row };
                    return next;
                }
                const position = opts?.position ?? 'start';
                return position === 'end' ? [...prev, row] : [row, ...prev];
            });
        },
        removeRow: (id: string) => {
            setData((prev) => prev.filter((r) => r.id !== id));
        },
    }), [setData]);

    const totalRows = externalTotalRows ?? hookTotalRows;
    const totalPages = Math.ceil(totalRows / pageSize);

    // Add SelectColumn to the beginning if not already present
    const gridColumns = columns[0]?.key === 'select-row'
        ? columns
        : [SelectColumn, ...columns];

    const handleCreateSuccess = () => {
        setIsCreateModalOpen(false);
        refresh();
    };

    return (
        <div>
            {/* Header */}
            <TableHeader
                title={title}
                backTo={backTo}
                onRefresh={showRefreshInline ? undefined : refresh}
                onCreateClick={renderCreateModal ? () => setIsCreateModalOpen(true) : undefined}
                createButtonLabel={createButtonLabel}
                isLoading={loading}
                additionalActions={headerActions}
            />

            {/* Subheader (optional) */}
            {renderSubheader?.()}

            {/* Search and Sort Controls */}
            <div className="flex flex-wrap gap-4 mb-6">
                {searchEnabled && (
                    <SearchBar
                        placeholder={searchPlaceholder}
                        onSearchChange={handleSearchChange}
                        onClear={clearSearch}
                        disabled={loading}
                    />
                )}
                <SortControls
                    sortOptions={sortOptions}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSortByChange={setSortBy}
                    onToggleSortOrder={toggleSortOrder}
                    disabled={loading}
                />
                {showRefreshInline && (
                    <button
                        onClick={refresh}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        <span>Refresh</span>
                    </button>
                )}
            </div>

            {/* Active Search Indicator */}
            {searchQuery && (
                <div className="mb-4 text-sm text-gray-500 dark:text-slate-400">
                    Showing results for:{' '}
                    <span className="font-medium text-gray-900 dark:text-white">"{searchQuery}"</span>
                </div>
            )}

            <div className="flex flex-1 min-h-0 gap-4">
                <div className="flex-1 flex flex-col min-w-0">

                    {/* Bulk Actions Toolbar */}
                    <BulkActionsToolbar
                        selectedCount={selectedRows.size}
                        onDelete={() => setBulkDeleteConfirm(true)}
                        onExport={onDownloadSelected ? undefined : handleExportCsv}
                        onDownload={onDownloadSelected ? () => onDownloadSelected(selectedRows) : undefined}
                        onClearSelection={() => setSelectedRows(new Set())}
                        isDeleting={isBulkDeleting}
                        showDownload={!!onDownloadSelected}
                    />

                    {/* Data Grid */}
                    <>
                        <div className="relative" style={{ height: gridHeight }}>
                            <DataGrid
                                columns={gridColumns}
                                rows={data}
                                rowKeyGetter={rowKeyGetter}
                                selectedRows={selectedRows}
                                onSelectedRowsChange={setSelectedRows}
                                onRowsChange={handleRowsChange}
                                className={theme === 'dark' ? 'rdg-dark' : 'rdg-light'}
                                onScroll={paginationMode === 'infinite' ? handleScroll : undefined}
                                rowHeight={rowHeight}
                                headerRowHeight={headerRowHeight}
                                style={{ height: '100%' }}
                                onCellClick={(args) => {
                                    // If the column has an edit cell renderer, enable single-click editing
                                    if (args.column.renderEditCell) {
                                        args.selectCell(true);
                                    } else if (onRowClick) {
                                        // If there's a row click handler and column is not editable, navigate
                                        onRowClick(args.row);
                                    }
                                }}
                                renderers={{
                                    noRowsFallback: (
                                        <div
                                            className="flex items-center justify-center text-gray-500 dark:text-slate-400"
                                            style={{
                                                gridColumn: '1 / -1',
                                                textAlign: 'center',
                                                padding: '3rem 1rem',
                                            }}
                                        >
                                            {loading ? loadingMessage : emptyMessage}
                                        </div>
                                    ),
                                }}
                            />

                            {/* Keep grid mounted while refreshing to avoid flicker */}
                            {loading && data.length > 0 && (
                                <div className="absolute inset-0 pointer-events-none bg-white/40 dark:bg-slate-900/40">
                                    <div className="flex items-center justify-center mt-6 text-sm text-gray-700 dark:text-slate-200 gap-2">
                                        <RefreshCw className="h-4 w-4 animate-spin" />
                                        <span>Refreshing…</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Infinite scroll loading indicator */}
                        {paginationMode === 'infinite' && isLoadingMore && (
                            <div className="text-center py-4 text-gray-500 dark:text-slate-400">
                                Loading more...
                            </div>
                        )}

                        {/* Page-based pagination controls */}
                        {paginationMode === 'pages' && totalPages > 1 && (
                            <div className="flex items-center justify-between mt-4 px-2">
                                <div className="text-sm text-gray-500 dark:text-slate-400">
                                    Showing {(page - 1) * pageSize + 1} to{' '}
                                    {Math.min(page * pageSize, totalRows)} of {totalRows} {entityName}s
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                        disabled={page === 1}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Previous
                                    </button>
                                    <span className="text-sm text-gray-600 dark:text-slate-400 px-3">
                                        Page {page} of {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                        disabled={page >= totalPages}
                                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                </div>

                {rightSidebar && (
                    <div className="flex-shrink-0">
                        {rightSidebar}
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {renderCreateModal?.({
                isOpen: isCreateModalOpen,
                onClose: () => setIsCreateModalOpen(false),
                onSuccess: handleCreateSuccess,
            })}

            {/* Bulk Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={bulkDeleteConfirm}
                onClose={() => setBulkDeleteConfirm(false)}
                onConfirm={handleBulkDelete}
                title={`Delete Selected ${entityName}${selectedRows.size === 1 ? '' : 's'}`}
                message={`Are you sure you want to delete ${selectedRows.size} selected ${entityName}${selectedRows.size === 1 ? '' : 's'}? This action cannot be undone.`}
                confirmText={isBulkDeleting ? 'Deleting...' : `Delete ${selectedRows.size} ${entityName}${selectedRows.size === 1 ? '' : 's'}`}
                isDangerous={true}
            />

            {/* Toast Notifications */}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
    );
}) as unknown as <T extends { id: string }>(
    props: DataTableProps<T> & { ref?: Ref<DataTableHandle<T>> }
) => ReactElement;
