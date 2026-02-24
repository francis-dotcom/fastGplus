import { useState, useCallback, useEffect, useMemo } from 'react';
import { DataGrid, SelectColumn, type Column } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { Play, History, Trash2, Clock, CheckCircle, XCircle, Star, Terminal, Download, FileText, Shield } from 'lucide-react';
import {
    executeQuerySqlQueryPost,
    getQueryHistorySqlHistoryGet,
    clearQueryHistorySqlHistoryDelete,
    getSnippetsSqlSnippetsGet,
    createSnippetSqlSnippetsPost,
    deleteSnippetSqlSnippetsSnippetIdDelete,
} from '../client/sdk.gen';
import type { SqlExecutionResult, SqlHistoryRead, SqlSnippetRead } from '../client/types.gen';
import { useTheme } from '../context/ThemeContext';
import { API_KEY } from '../lib/api';
import { Modal, Input, Textarea, Label, ConfirmationModal, ToastContainer } from '../components';
import type { ToastMessage } from '../components/Toast';
import { hasError, getErrorMessage } from '../lib/utils';

type TabType = 'history' | 'rls-examples' | 'favourites';

// RLS Policy Templates
const RLS_TEMPLATES = [
    {
        name: 'Enable RLS on Table',
        description: 'Enable Row Level Security and force it for all users including table owner',
        sql: `-- Enable RLS on a table
ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY;
ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY;`,
    },
    {
        name: 'Owner-Only Access',
        description: 'Users can only access rows where they are the owner',
        sql: `-- Owner-only access (all operations)
CREATE POLICY "owner_access" ON {table_name}
  FOR ALL USING (owner_id = auth.uid());`,
    },
    {
        name: 'Public Read, Auth Write',
        description: 'Anyone can read, only authenticated users can write',
        sql: `-- Public read access
CREATE POLICY "public_read" ON {table_name}
  FOR SELECT USING (true);

-- Authenticated users can insert
CREATE POLICY "authenticated_write" ON {table_name}
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Only owner can update
CREATE POLICY "owner_update" ON {table_name}
  FOR UPDATE USING (owner_id = auth.uid());

-- Only owner can delete
CREATE POLICY "owner_delete" ON {table_name}
  FOR DELETE USING (owner_id = auth.uid());`,
    },
    {
        name: 'Team/Organization Access',
        description: 'Users can access rows belonging to their team',
        sql: `-- Team/organization access
CREATE POLICY "team_access" ON {table_name}
  FOR SELECT USING (
    team_id IN (
      SELECT team_id FROM team_members 
      WHERE user_id = auth.uid()
    )
  );`,
    },
    {
        name: 'Admin Bypass Pattern',
        description: 'Allow admins to bypass RLS restrictions',
        sql: `-- Admin bypass pattern (add to any policy)
-- Example: Allow admins OR owners
CREATE POLICY "owner_or_admin" ON {table_name}
  FOR ALL USING (
    owner_id = auth.uid() OR auth.role() = 'ADMIN'
  );`,
    },
    {
        name: 'Role-Based Access',
        description: 'Different access levels based on user role',
        sql: `-- Role-based access control
-- Admins can do everything
CREATE POLICY "admin_all" ON {table_name}
  FOR ALL USING (auth.role() = 'ADMIN');

-- Regular users can only read
CREATE POLICY "user_read" ON {table_name}
  FOR SELECT USING (auth.role() = 'USER');`,
    },
    {
        name: 'Drop Policy',
        description: 'Remove an existing RLS policy',
        sql: `-- Drop a policy
DROP POLICY IF EXISTS "policy_name" ON {table_name};`,
    },
    {
        name: 'Disable RLS',
        description: 'Disable Row Level Security on a table',
        sql: `-- Disable RLS on a table
ALTER TABLE {table_name} DISABLE ROW LEVEL SECURITY;`,
    },
];

// Row type for the DataGrid - must have id as string
type ResultRow = {
    id: string;
    [key: string]: unknown;
};

export default function SqlEditor() {
    const { theme } = useTheme();

    // SQL query state
    const [query, setQuery] = useState('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [result, setResult] = useState<SqlExecutionResult | null>(null);
    const [resourceName, setResourceName] = useState<string | null>(null);

    // Extract table name from SQL (FROM x, INTO x, UPDATE x)
    const extractResourceName = (sql: string) =>
        sql.match(/(?:from|into|update)\s+(\w+)/i)?.[1]?.toLowerCase() ?? null;

    // Row selection state for results
    const [selectedRows, setSelectedRows] = useState<ReadonlySet<string>>(new Set());

    // Right sidebar state
    const [activeTab, setActiveTab] = useState<TabType>('history');
    const [history, setHistory] = useState<SqlHistoryRead[]>([]);
    const [favourites, setFavourites] = useState<SqlSnippetRead[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [isLoadingFavourites, setIsLoadingFavourites] = useState(false);

    // Modal states for saving to favourites
    const [saveToFavouriteModal, setSaveToFavouriteModal] = useState<{ open: boolean; query: string }>({ open: false, query: '' });
    const [favouriteName, setFavouriteName] = useState('');
    const [favouriteDescription, setFavouriteDescription] = useState('');
    const [isSavingFavourite, setIsSavingFavourite] = useState(false);
    const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);
    const [deleteFavouriteConfirm, setDeleteFavouriteConfirm] = useState<string | null>(null);

    // Toast state
    const [toasts, setToasts] = useState<ToastMessage[]>([]);

    const addToast = useCallback((type: ToastMessage['type'], message: string) => {
        const id = crypto.randomUUID();
        setToasts(prev => [...prev, { id, type, message }]);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Load history
    const loadHistory = useCallback(async () => {
        setIsLoadingHistory(true);
        try {
            const response = await getQueryHistorySqlHistoryGet({
                headers: { 'X-API-Key': API_KEY },
                query: { limit: 100 },
            });
            if (!hasError(response) && response.data) {
                setHistory(response.data.history || []);
            }
        } catch (err) {
            console.error('Failed to load history:', err);
        } finally {
            setIsLoadingHistory(false);
        }
    }, []);

    // Load favourites (snippets)
    const loadFavourites = useCallback(async () => {
        setIsLoadingFavourites(true);
        try {
            const response = await getSnippetsSqlSnippetsGet({ headers: { 'X-API-Key': API_KEY } });
            if (!hasError(response) && response.data) {
                setFavourites(response.data.snippets || []);
            }
        } catch (err) {
            console.error('Failed to load favourites:', err);
        } finally {
            setIsLoadingFavourites(false);
        }
    }, []);

    // Load data on mount and tab change
    useEffect(() => {
        if (activeTab === 'history') {
            loadHistory();
        } else {
            loadFavourites();
        }
    }, [activeTab, loadHistory, loadFavourites]);

    // Clear selection when results change
    useEffect(() => {
        setSelectedRows(new Set());
    }, [result]);

    // Execute SQL query
    const executeQuery = async () => {
        if (!query.trim()) return;

        setIsExecuting(true);
        setResult(null);
        setSelectedRows(new Set());

        try {
            const response = await executeQuerySqlQueryPost({
                headers: { 'X-API-Key': API_KEY },
                body: { query: query.trim() },
            });

            if (hasError(response)) {
                const errorMsg = getErrorMessage(response.error);
                setResult({
                    success: false,
                    is_read_only: false,
                    execution_time: 0,
                    error: errorMsg,
                });
                addToast('error', errorMsg);
            } else {
                setResult(response.data ?? null);
                // Extract and set resource name from query
                const extracted = extractResourceName(query);
                setResourceName(extracted);
                // Clear the query input after successful execution
                setQuery('');
                // Reload history after successful execution
                loadHistory();
                // Show success toast
                const data = response.data;
                const rowCount = data?.row_count ?? 0;
                const execTime = data?.execution_time;
                const timeStr = execTime !== undefined ? (execTime < 1 ? `${(execTime * 1000).toFixed(2)}ms` : `${execTime.toFixed(2)}s`) : '';
                addToast('success', `Query returned ${rowCount} row(s)${timeStr ? ` (${timeStr})` : ''}`);
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Failed to execute query';
            setResult({
                success: false,
                is_read_only: false,
                execution_time: 0,
                error: errorMsg,
            });
            addToast('error', errorMsg);
        } finally {
            setIsExecuting(false);
        }
    };

    // Clear history
    const handleClearHistory = async () => {
        try {
            const response = await clearQueryHistorySqlHistoryDelete({ headers: { 'X-API-Key': API_KEY } });
            if (!hasError(response)) {
                setHistory([]);
            }
        } catch (err) {
            console.error('Failed to clear history:', err);
        } finally {
            setClearHistoryConfirm(false);
        }
    };

    // Save history item to favourites
    const handleSaveToFavourite = async () => {
        if (!favouriteName.trim() || !saveToFavouriteModal.query.trim()) return;
        setIsSavingFavourite(true);
        try {
            const response = await createSnippetSqlSnippetsPost({
                headers: { 'X-API-Key': API_KEY },
                body: {
                    name: favouriteName.trim(),
                    sql_code: saveToFavouriteModal.query.trim(),
                    description: favouriteDescription.trim() || undefined,
                    is_shared: false,
                },
            });
            if (!hasError(response)) {
                setSaveToFavouriteModal({ open: false, query: '' });
                setFavouriteName('');
                setFavouriteDescription('');
                loadFavourites();
            }
        } catch (err) {
            console.error('Failed to save favourite:', err);
        } finally {
            setIsSavingFavourite(false);
        }
    };

    // Delete favourite
    const handleDeleteFavourite = async (favouriteId: string) => {
        try {
            const response = await deleteSnippetSqlSnippetsSnippetIdDelete({
                headers: { 'X-API-Key': API_KEY },
                path: { snippet_id: favouriteId },
            });
            if (!hasError(response)) {
                loadFavourites();
            }
        } catch (err) {
            console.error('Failed to delete favourite:', err);
        } finally {
            setDeleteFavouriteConfirm(null);
        }
    };

    // Load query from history or favourite into input
    const loadQueryToInput = (sqlQuery: string) => {
        setQuery(sqlQuery);
    };

    // Open save to favourite modal
    const openSaveToFavourite = (sqlQuery: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent loading query when clicking star
        setSaveToFavouriteModal({ open: true, query: sqlQuery });
        setFavouriteName('');
        setFavouriteDescription('');
    };

    // Convert data to rows with string id
    const rows: ResultRow[] = useMemo(() =>
        (result?.data || []).map((row, index) => ({
            id: String(index),
            ...row,
        })), [result?.data]
    );

    // Generate columns from result (with SelectColumn)
    const columns: Column<ResultRow>[] = useMemo(() => {
        const dataColumns: Column<ResultRow>[] = result?.columns?.map((col) => ({
            key: col,
            name: col,
            resizable: true,
            minWidth: 100,
            renderCell: ({ row }: { row: ResultRow }) => {
                const value = row[col];
                if (value === null || value === undefined) {
                    return <span className="text-gray-400 dark:text-slate-500 italic">null</span>;
                }
                if (typeof value === 'object') {
                    return <span className="text-xs font-mono">{JSON.stringify(value)}</span>;
                }
                if (typeof value === 'boolean') {
                    return value ? 'true' : 'false';
                }
                return String(value);
            },
        })) || [];

        return [SelectColumn, ...dataColumns];
    }, [result?.columns]);

    // Get selected rows data for export
    const getSelectedRowsData = useCallback(() => {
        if (selectedRows.size === 0) return [];
        return rows.filter(row => selectedRows.has(row.id));
    }, [rows, selectedRows]);

    // Export selected rows as CSV
    const handleExportCsv = useCallback(() => {
        const selectedData = getSelectedRowsData();
        if (selectedData.length === 0 || !result?.columns) return;

        const headers = result.columns;
        const csvContent = [
            headers.join(','),
            ...selectedData.map(row =>
                headers.map(col => {
                    const value = row[col];
                    // Escape quotes and wrap in quotes if contains comma or quote
                    const strValue = value === null || value === undefined ? '' : String(value);
                    if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
                        return `"${strValue.replace(/"/g, '""')}"`;
                    }
                    return strValue;
                }).join(',')
            )
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const filename = resourceName || 'sql_results';
        link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [getSelectedRowsData, result?.columns, resourceName]);

    // Export selected rows as Text
    const handleExportText = useCallback(() => {
        const selectedData = getSelectedRowsData();
        if (selectedData.length === 0 || !result?.columns) return;

        const headers = result.columns;
        const textContent = selectedData.map(row =>
            headers.map(col => `${col}: ${row[col] ?? 'null'}`).join('\n')
        ).join('\n\n---\n\n');

        const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const filename = resourceName || 'sql_results';
        link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, [getSelectedRowsData, result?.columns, resourceName]);

    // Format execution time
    const formatExecutionTime = (time?: number | null) => {
        if (time === undefined || time === null) return '';
        if (time < 1) return `${(time * 1000).toFixed(2)}ms`;
        return `${time.toFixed(2)}s`;
    };

    // Format date
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString();
    };

    return (
        <div className="h-[var(--page-content-height)] flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                    {resourceName ? resourceName : 'SQL Editor'}
                </h1>
            </div>

            {/* Main Layout - Results and Sidebar */}
            <div className="flex gap-4 flex-1 min-h-0">
                {/* Main Content Area - Results Display */}
                <div className="flex-1 flex flex-col min-w-0">
                    {/* Selection Actions Toolbar */}
                    {selectedRows.size > 0 && (
                        <div className="mb-3 p-2 bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 rounded-lg flex items-center justify-between">
                            <span className="text-sm text-primary-700 dark:text-primary-300">
                                {selectedRows.size} row{selectedRows.size !== 1 ? 's' : ''} selected
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleExportCsv}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 bg-white dark:bg-slate-800 border border-primary-300 dark:border-primary-700 rounded hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                >
                                    <Download className="h-3.5 w-3.5" />
                                    Export CSV
                                </button>
                                <button
                                    onClick={handleExportText}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-700 dark:text-primary-300 bg-white dark:bg-slate-800 border border-primary-300 dark:border-primary-700 rounded hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                >
                                    <FileText className="h-3.5 w-3.5" />
                                    Export Text
                                </button>
                                <button
                                    onClick={() => setSelectedRows(new Set())}
                                    className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
                                >
                                    Clear Selection
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Results - Main Display Area */}
                    <div className="flex-1 flex flex-col min-h-0">
                        {/* Data Grid for Results */}
                        {result?.success && result.data && result.data.length > 0 ? (
                            <DataGrid
                                columns={columns}
                                rows={rows}
                                rowKeyGetter={(row) => row.id}
                                selectedRows={selectedRows}
                                onSelectedRowsChange={setSelectedRows}
                                className={theme === 'dark' ? 'rdg-dark' : 'rdg-light'}
                                style={{ height: '100%' }}
                                rowHeight={40}
                                headerRowHeight={40}
                                renderers={{
                                    noRowsFallback: (
                                        <div className="flex items-center justify-center text-gray-500 dark:text-slate-400 h-full">
                                            No results
                                        </div>
                                    ),
                                }}
                            />
                        ) : (
                            /* Empty state / Loading state */
                            <div className="flex-1 flex items-center justify-center bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700">
                                {isExecuting ? (
                                    <div className="text-center">
                                        <div className="animate-spin h-10 w-10 border-4 border-primary-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                                        <p className="text-gray-500 dark:text-slate-400">Executing query...</p>
                                    </div>
                                ) : (
                                    <div className="text-center text-gray-400 dark:text-slate-500">
                                        <Terminal className="h-16 w-16 mx-auto mb-4 opacity-30" />
                                        <p className="text-lg">SQL DDL Results will appear here</p>
                                        <p className="text-sm mt-2">Enter a SQL command in the right panel and execute</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Sidebar - SQL Input & History */}
                <div className="w-96 flex-shrink-0 border border-gray-200 dark:border-slate-700 rounded-lg p-4 flex flex-col">
                    {/* Tabs - History / RLS Examples / Favourites */}
                    <div className="flex border-b border-gray-200 dark:border-slate-700 mb-3">
                        <button
                            onClick={() => setActiveTab('history')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history'
                                    ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                                }`}
                        >
                            <History className="h-4 w-4" />
                            <span className="hidden sm:inline">History</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('rls-examples')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'rls-examples'
                                    ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                                }`}
                        >
                            <Shield className="h-4 w-4" />
                            <span className="hidden sm:inline">RLS</span>
                        </button>
                        <button
                            onClick={() => setActiveTab('favourites')}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === 'favourites'
                                    ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300'
                                }`}
                        >
                            <Star className="h-4 w-4" />
                            <span className="hidden sm:inline">Saved</span>
                        </button>
                    </div>

                    {/* History / Favourites List - Scrollable */}
                    <div className="flex-1 overflow-y-auto mb-3 min-h-0">
                        {activeTab === 'history' && (
                            <div className="space-y-2">
                                {/* Clear History Button */}
                                {history.length > 0 && (
                                    <button
                                        onClick={() => setClearHistoryConfirm(true)}
                                        className="w-full mb-2 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex items-center justify-center gap-1"
                                    >
                                        <Trash2 className="h-3 w-3" />
                                        Clear All History
                                    </button>
                                )}

                                {isLoadingHistory ? (
                                    <div className="text-center text-gray-500 dark:text-slate-400 py-6 text-sm">
                                        Loading history...
                                    </div>
                                ) : history.length === 0 ? (
                                    <div className="text-center text-gray-500 dark:text-slate-400 py-6">
                                        <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">No query history yet</p>
                                    </div>
                                ) : (
                                    history.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => loadQueryToInput(item.query)}
                                            className="w-full text-left p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-colors"
                                        >
                                            <div className="flex items-start gap-2 mb-1.5">
                                                {item.error ? (
                                                    <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                                                ) : (
                                                    <CheckCircle className="h-3.5 w-3.5 text-green-500 flex-shrink-0 mt-0.5" />
                                                )}
                                                <code className="flex-1 text-xs font-mono text-gray-700 dark:text-slate-300 line-clamp-2 break-all">
                                                    {item.query}
                                                </code>
                                            </div>
                                            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-500">
                                                <div className="flex items-center gap-1">
                                                    <Clock className="h-3 w-3" />
                                                    <span>{formatDate(item.executed_at)}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {item.execution_time !== undefined && item.execution_time !== null && (
                                                        <span>{formatExecutionTime(item.execution_time)}</span>
                                                    )}
                                                    {/* Save to Favourites Button */}
                                                    <button
                                                        onClick={(e) => openSaveToFavourite(item.query, e)}
                                                        className="p-1 text-gray-400 hover:text-yellow-500 dark:text-slate-500 dark:hover:text-yellow-400 transition-colors"
                                                        title="Save to Favourites"
                                                    >
                                                        <Star className="h-3.5 w-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        )}

                        {activeTab === 'favourites' && (
                            <div className="space-y-2">
                                {isLoadingFavourites ? (
                                    <div className="text-center text-gray-500 dark:text-slate-400 py-6 text-sm">
                                        Loading favourites...
                                    </div>
                                ) : favourites.length === 0 ? (
                                    <div className="text-center text-gray-500 dark:text-slate-400 py-6">
                                        <Star className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                        <p className="text-sm">No favourites yet</p>
                                        <p className="text-xs mt-1">Save queries from history</p>
                                    </div>
                                ) : (
                                    favourites.map((favourite) => (
                                        <div
                                            key={favourite.id}
                                            className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
                                        >
                                            <div className="flex items-start justify-between gap-2 mb-1">
                                                <button
                                                    onClick={() => loadQueryToInput(favourite.sql_code)}
                                                    className="flex-1 text-left"
                                                >
                                                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                                                        {favourite.name}
                                                    </h4>
                                                    {favourite.description && (
                                                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                                                            {favourite.description}
                                                        </p>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => setDeleteFavouriteConfirm(favourite.id)}
                                                    className="p-1 text-gray-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 transition-colors"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                            <button
                                                onClick={() => loadQueryToInput(favourite.sql_code)}
                                                className="w-full text-left"
                                            >
                                                <code className="text-xs font-mono text-gray-600 dark:text-slate-400 line-clamp-2 break-all">
                                                    {favourite.sql_code}
                                                </code>
                                            </button>
                                            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-slate-500 mt-1.5">
                                                <span>{formatDate(favourite.created_at)}</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {activeTab === 'rls-examples' && (
                            <div className="space-y-2">
                                <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
                                    Click a template to load it into the editor. Replace <code className="bg-gray-100 dark:bg-slate-700 px-1 rounded">{'\{table_name\}'}</code> with your table name.
                                </p>
                                {RLS_TEMPLATES.map((template, index) => (
                                    <button
                                        key={index}
                                        onClick={() => loadQueryToInput(template.sql)}
                                        className="w-full text-left p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 hover:border-primary-300 dark:hover:border-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/10 transition-colors"
                                    >
                                        <div className="flex items-start gap-2 mb-1">
                                            <Shield className="h-3.5 w-3.5 text-primary-500 flex-shrink-0 mt-0.5" />
                                            <div className="flex-1">
                                                <h4 className="text-sm font-medium text-gray-900 dark:text-white">
                                                    {template.name}
                                                </h4>
                                                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                                                    {template.description}
                                                </p>
                                            </div>
                                        </div>
                                        <code className="block text-xs font-mono text-gray-600 dark:text-slate-400 line-clamp-2 break-all mt-1.5 pl-5">
                                            {template.sql.split('\n')[0]}
                                        </code>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* SQL Input Area - Fixed at bottom */}
                    <div className="border-t border-gray-200 dark:border-slate-700 pt-3">
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                            Enter SQL Commands
                        </label>
                        <textarea
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="SELECT * FROM users LIMIT 10;"
                            className="w-full h-32 px-3 py-2 font-mono text-sm bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                            onKeyDown={(e) => {
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                    e.preventDefault();
                                    executeQuery();
                                }
                            }}
                        />
                        <div className="flex items-center justify-between mt-2">
                            <p className="text-xs text-gray-500 dark:text-slate-400">
                                <kbd className="px-1 py-0.5 text-xs font-semibold bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded">⌘</kbd>+<kbd className="px-1 py-0.5 text-xs font-semibold bg-gray-100 dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded">↵</kbd> to run
                            </p>
                            <button
                                onClick={executeQuery}
                                disabled={isExecuting || !query.trim()}
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                            >
                                <Play className="h-4 w-4" />
                                {isExecuting ? 'Running...' : 'Execute'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Save to Favourite Modal */}
            <Modal
                isOpen={saveToFavouriteModal.open}
                onClose={() => setSaveToFavouriteModal({ open: false, query: '' })}
                title="Save to Favourites"
            >
                <div className="space-y-4">
                    <div>
                        <Label htmlFor="favourite-name">Name</Label>
                        <Input
                            id="favourite-name"
                            value={favouriteName}
                            onChange={(e) => setFavouriteName(e.target.value)}
                            placeholder="e.g., Get all users"
                        />
                    </div>
                    <div>
                        <Label htmlFor="favourite-description">Description (optional)</Label>
                        <Textarea
                            id="favourite-description"
                            value={favouriteDescription}
                            onChange={(e) => setFavouriteDescription(e.target.value)}
                            placeholder="What does this query do?"
                            rows={2}
                        />
                    </div>
                    <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-3">
                        <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">Query to save:</p>
                        <code className="text-xs font-mono text-gray-700 dark:text-slate-300 break-all">
                            {saveToFavouriteModal.query.length > 200
                                ? `${saveToFavouriteModal.query.substring(0, 200)}...`
                                : saveToFavouriteModal.query}
                        </code>
                    </div>
                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            onClick={() => setSaveToFavouriteModal({ open: false, query: '' })}
                            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSaveToFavourite}
                            disabled={isSavingFavourite || !favouriteName.trim()}
                            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors"
                        >
                            {isSavingFavourite ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Clear History Confirmation */}
            <ConfirmationModal
                isOpen={clearHistoryConfirm}
                onClose={() => setClearHistoryConfirm(false)}
                onConfirm={handleClearHistory}
                title="Clear Query History"
                message="Are you sure you want to clear all query history? This action cannot be undone."
                confirmText="Clear History"
                isDangerous
            />

            {/* Delete Favourite Confirmation */}
            <ConfirmationModal
                isOpen={!!deleteFavouriteConfirm}
                onClose={() => setDeleteFavouriteConfirm(null)}
                onConfirm={() => {
                    if (deleteFavouriteConfirm) {
                        handleDeleteFavourite(deleteFavouriteConfirm);
                    }
                }}
                title="Delete Favourite"
                message="Are you sure you want to delete this favourite? This action cannot be undone."
                confirmText="Delete"
                isDangerous
            />

            {/* Toast notifications */}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </div>
    );
}
