import { Trash2, Download, X } from 'lucide-react';

interface BulkActionsToolbarProps {
    selectedCount: number;
    onDelete: () => void;
    onExport?: () => void;
    onDownload?: () => void;
    onClearSelection: () => void;
    isDeleting?: boolean;
    /** When true, shows Download button instead of Export CSV */
    showDownload?: boolean;
}

/**
 * Toolbar component that appears when rows are selected in a data grid.
 * Shows bulk action buttons for delete and export/download.
 */
export default function BulkActionsToolbar({
    selectedCount,
    onDelete,
    onExport,
    onDownload,
    onClearSelection,
    isDeleting = false,
    showDownload = false,
}: BulkActionsToolbarProps) {
    if (selectedCount === 0) {
        return null;
    }

    const handleSecondaryAction = showDownload ? onDownload : onExport;
    const secondaryLabel = showDownload ? 'Download' : 'Export CSV';
    const secondaryTitle = showDownload ? 'Download selected files' : 'Export selected to CSV';

    return (
        <div className="flex items-center gap-4 mb-4 p-3 bg-blue-50 dark:bg-slate-800 border border-blue-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    {selectedCount} {selectedCount === 1 ? 'item' : 'items'} selected
                </span>
                <button
                    onClick={onClearSelection}
                    className="p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-slate-700 rounded transition-colors"
                    title="Clear selection"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="h-4 w-px bg-blue-200 dark:bg-slate-600" />

            <div className="flex items-center gap-2">
                {handleSecondaryAction && (
                    <button
                        onClick={handleSecondaryAction}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                        title={secondaryTitle}
                    >
                        <Download className="h-4 w-4" />
                        {secondaryLabel}
                    </button>
                )}

                <button
                    onClick={onDelete}
                    disabled={isDeleting}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Delete selected items"
                >
                    <Trash2 className="h-4 w-4" />
                    {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
            </div>
        </div>
    );
}
