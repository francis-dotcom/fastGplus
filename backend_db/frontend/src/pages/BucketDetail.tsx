import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { type Column } from 'react-data-grid';
import {
    Upload,
    File,
    RefreshCw,
    FolderOpen,
    FileText,
    FileImage,
    FileVideo,
    FileAudio,
    FileArchive,
    FileCode
} from 'lucide-react';
import {
    getBucketStorageBucketsBucketIdGet,
    listFilesStorageFilesGet,
    uploadFileStorageFilesUploadPost,
    deleteFileStorageFilesFileIdDelete,
} from '../client/sdk.gen';
import type { BucketResponse, FileResponse } from '../client/types.gen';
import { useAuth } from '../context/AuthContext';
import { API_KEY } from '../lib/api';
import {
    ConfirmationModal,
    DataTable,
    type DataTableApi,
    type DataTableHandle,
    type SortOption,
    type ExportConfig,
} from '../components';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../lib/useToast';
import { getErrorMessage, hasError } from '../lib/utils';
import { formatDate } from '../lib/formatDate';

type FileRow = FileResponse;

const PAGE_SIZE = 50;

// Sort options for the dropdown
const SORT_OPTIONS: SortOption[] = [
    { value: 'created_at', label: 'Created Date' },
    { value: 'updated_at', label: 'Updated Date' },
    { value: 'name', label: 'Name' },
    { value: 'size', label: 'Size' },
];

// Export configuration
const EXPORT_CONFIG: ExportConfig = {
    columns: [
        { key: 'id', name: 'ID' },
        { key: 'name', name: 'Name' },
        { key: 'path', name: 'Path' },
        { key: 'size', name: 'Size' },
        { key: 'mime_type', name: 'Type' },
        { key: 'created_at', name: 'Created At' },
        { key: 'updated_at', name: 'Updated At' },
    ],
    filename: 'files.csv',
};

// Format file size for display
function formatSize(bytes: number | undefined): string {
    if (bytes === undefined || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Get icon based on mime type
function getFileIcon(mimeType: string) {
    if (mimeType.startsWith('image/')) return FileImage;
    if (mimeType.startsWith('video/')) return FileVideo;
    if (mimeType.startsWith('audio/')) return FileAudio;
    if (mimeType.includes('zip') || mimeType.includes('archive') || mimeType.includes('tar') || mimeType.includes('rar')) return FileArchive;
    if (mimeType.includes('text/') || mimeType.includes('json') || mimeType.includes('xml') || mimeType.includes('javascript') || mimeType.includes('css')) return FileCode;
    if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('word')) return FileText;
    return File;
}

export default function BucketDetail() {
    const { bucketId } = useParams<{ bucketId: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { toasts, dismissToast, showSuccess, showError } = useToast();

    // Bucket state
    const [bucket, setBucket] = useState<BucketResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRefreshingBucket, setIsRefreshingBucket] = useState(false);

    // Upload state
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<string>('');

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState<{
        isOpen: boolean;
        fileId: string | null;
        fileName: string | null;
    }>({
        isOpen: false,
        fileId: null,
        fileName: null,
    });

    // DataTable imperative handle (for optimistic row upserts)
    const dataTableRef = useRef<DataTableHandle<FileRow> | null>(null);

    // Fetch bucket details
    const fetchBucket = useCallback(async (opts?: { initial?: boolean }) => {
        if (!token || !bucketId) return;

        try {
            const isInitial = opts?.initial === true;
            if (isInitial) setLoading(true);
            else setIsRefreshingBucket(true);
            const response = await getBucketStorageBucketsBucketIdGet({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    bucket_id: bucketId,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            if (response.data) {
                setBucket(response.data);
            }
        } catch (error) {
            console.error('Failed to fetch bucket:', error);
            showError(getErrorMessage(error));
        } finally {
            setLoading(false);
            setIsRefreshingBucket(false);
        }
    }, [token, bucketId, showError]);

    useEffect(() => {
        fetchBucket({ initial: true });
    }, [fetchBucket]);

    // API operations for DataTable
    const api: DataTableApi<FileRow> = useMemo(() => ({
        fetch: async ({ page, pageSize, search, sortBy, sortOrder }) => {
            if (!token || !bucketId) {
                return { data: [], hasMore: false };
            }

            const response = await listFilesStorageFilesGet({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                query: {
                    bucket_id: bucketId,
                    page,
                    page_size: pageSize,
                    search: search || undefined,
                    sort_by: sortBy as 'created_at' | 'updated_at' | 'name' | 'size' | undefined,
                    sort_order: sortOrder,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            const data = response.data?.files || [];
            const total = response.data?.total || 0;

            return {
                data,
                total,
                hasMore: data.length === pageSize,
            };
        },

        // Files don't support inline editing, return unchanged
        update: async (_id, data) => {
            return data as FileRow;
        },

        delete: async (id) => {
            const response = await deleteFileStorageFilesFileIdDelete({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    file_id: id,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            // Refresh bucket info to update file count
            fetchBucket({ initial: false });
        },
    }), [token, bucketId, fetchBucket]);

    // Handle file download
    const handleDownload = async (file: FileRow) => {
        if (!token || !bucket) return;

        try {
            // Construct download URL
            const baseUrl = import.meta.env.DEV
                ? import.meta.env.VITE_DEV_API_URL
                : '/api';

            const downloadUrl = `${baseUrl}/storage/files/download/${bucket.name}/${file.path}`;

            // Fetch the file with auth headers
            const response = await fetch(downloadUrl, {
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
            });

            if (!response.ok) {
                throw new Error(`Download failed: ${response.statusText}`);
            }

            // Create blob and download
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Download failed:', error);
            showError(getErrorMessage(error));
        }
    };

    // Handle file upload using streaming (raw bytes)
    const handleUpload = async (files: FileList | null) => {
        if (!token || !bucketId || !files || files.length === 0) return;

        setUploading(true);
        let successCount = 0;
        let failCount = 0;
        let didAnySuccess = false;

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                setUploadProgress(`Uploading ${i + 1}/${files.length}: ${file.name}`);

                try {
                    // Use SDK with query params for metadata and raw file as body
                    const response = await uploadFileStorageFilesUploadPost({
                        headers: {
                            'X-API-Key': API_KEY,
                            Authorization: `Bearer ${token}`,
                            'Content-Type': file.type || 'application/octet-stream',
                        },
                        query: {
                            bucket_id: bucketId,
                            filename: file.name,
                            content_type: file.type || 'application/octet-stream',
                        },
                        body: file as unknown as never, // Raw file bytes for streaming
                        bodySerializer: (body) => body as BodyInit, // Don't serialize, send raw
                    });

                    if (hasError(response)) {
                        console.error(`Failed to upload ${file.name}:`, response.error);
                        failCount++;
                    } else {
                        successCount++;
                        didAnySuccess = true;
                        // Optimistically insert the uploaded file into the table without remounting/refetching
                        const upload = response.data;
                        if (upload) {
                            const nowIso = new Date().toISOString();
                            const derivedName = upload.path?.split('/').pop() || file.name;
                            dataTableRef.current?.upsertRow({
                                id: upload.file_id || crypto.randomUUID(),
                                bucket_id: bucketId,
                                name: derivedName,
                                path: upload.path,
                                size: upload.size,
                                mime_type: file.type || 'application/octet-stream',
                                created_at: nowIso,
                                updated_at: nowIso,
                            } as FileRow, { position: 'start' });
                        }
                    }
                } catch (error) {
                    console.error(`Failed to upload ${file.name}:`, error);
                    failCount++;
                }
            }

            // Show result
            if (failCount === 0) {
                showSuccess(`Successfully uploaded ${successCount} file(s)`);
            } else {
                showError(`Uploaded ${successCount} file(s), ${failCount} failed`);
            }

            // Refresh data
            if (didAnySuccess) {
                fetchBucket({ initial: false }); // Refresh bucket stats (file count, total size) without unmounting UI
            }
        } catch (error) {
            console.error('Upload failed:', error);
            showError(getErrorMessage(error));
        } finally {
            setUploading(false);
            setUploadProgress('');
        }
    };

    // Handle delete confirmation
    const handleDeleteConfirm = async () => {
        if (!deleteConfirm.fileId) return;

        try {
            await api.delete!(deleteConfirm.fileId);
            showSuccess('File deleted successfully');
        } catch (error) {
            showError(getErrorMessage(error));
        } finally {
            setDeleteConfirm({ isOpen: false, fileId: null, fileName: null });
        }
    };

    // Handle bulk download selected files
    const handleDownloadSelected = useCallback(async (selectedIds: ReadonlySet<string>) => {
        if (selectedIds.size === 0) return;

        try {
            // Fetch all files in bucket to find the selected ones
            const response = await listFilesStorageFilesGet({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                query: {
                    bucket_id: bucketId!,
                    page: 1,
                    page_size: 1000,
                },
            });

            if (response.data?.files) {
                for (const file of response.data.files) {
                    if (selectedIds.has(file.id)) {
                        await handleDownload(file);
                    }
                }
            }
        } catch (error) {
            showError(getErrorMessage(error));
        }
    }, [token, bucketId, handleDownload, showError]);

    // Column definitions
    const columns: Column<FileRow>[] = useMemo(() => [

        {
            key: 'name',
            name: 'Name',
            resizable: true,
            minWidth: 250,
            renderCell: ({ row }) => {
                const IconComponent = getFileIcon(row.mime_type);
                return (
                    <div className="flex items-center gap-2">
                        <IconComponent className="h-4 w-4 text-primary-400 flex-shrink-0" />
                        <span className="font-medium truncate">{row.name}</span>
                    </div>
                );
            }
        },
        {
            key: 'path',
            name: 'Path',
            resizable: true,
            minWidth: 200,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {row.path}
                </span>
            )
        },
        {
            key: 'size',
            name: 'Size',
            resizable: true,
            minWidth: 100,
            renderCell: ({ row }) => formatSize(row.size)
        },
        {
            key: 'mime_type',
            name: 'Type',
            resizable: true,
            minWidth: 150,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {row.mime_type}
                </span>
            )
        },
        {
            key: 'created_at',
            name: 'Created At',
            resizable: true,
            minWidth: 180,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {formatDate(row.created_at)}
                </span>
            )
        },
    ], []);

    // Loading state
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <RefreshCw className="h-8 w-8 text-primary-400 animate-spin" />
            </div>
        );
    }

    // Not found state
    if (!bucket) {
        return (
            <div className="text-center py-12">
                <FolderOpen className="h-12 w-12 text-gray-400 dark:text-slate-500 mx-auto mb-4" />
                <p className="text-gray-500 dark:text-slate-400">Bucket not found</p>
                <button
                    onClick={() => navigate('/storage')}
                    className="mt-4 text-primary-600 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-300"
                >
                    Back to Storage
                </button>
            </div>
        );
    }

    return (
        <>
            <DataTable<FileRow>
                ref={dataTableRef}
                columns={columns}
                api={api}
                title={bucket.name}
                entityName="file"
                sortOptions={SORT_OPTIONS}
                exportConfig={{ ...EXPORT_CONFIG, filename: `${bucket.name}_files.csv` }}
                pageSize={PAGE_SIZE}
                defaultSortBy="created_at"
                defaultSortOrder="desc"
                searchPlaceholder="Search files..."
                emptyMessage="No files in this bucket. Drag and drop files to upload."
                loadingMessage="Loading files..."
                backTo={{ path: '/storage', label: 'Back to Storage' }}
                onDownloadSelected={handleDownloadSelected}
                gridHeight="calc(var(--page-content-height) - 188px)"
                headerActions={
                    <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-slate-400">
                        <span className={bucket.public ? 'text-green-600 dark:text-green-400' : ''}>
                            {bucket.public ? 'Public' : 'Private'}
                        </span>
                        <span>•</span>
                        <span>{bucket.file_count ?? 0} files</span>
                        <span>•</span>
                        <span>{formatSize(bucket.total_size)}</span>
                        {isRefreshingBucket && (
                            <>
                                <span>•</span>
                                <span className="text-xs">Refreshing…</span>
                            </>
                        )}
                    </div>
                }
                renderSubheader={() => (
                    <p className="mb-4 text-sm text-gray-500 dark:text-slate-400">
                        {bucket.description || 'No description'}
                    </p>
                )}
                rightSidebar={
                    <div className="w-96 flex-shrink-0 border border-gray-200 dark:border-slate-700 rounded-lg p-4 flex flex-col bg-white dark:bg-slate-800 h-full">
                        <div
                            className={`w-full h-full border-2 border-dashed rounded-lg flex flex-col items-center justify-center p-4 transition-colors ${uploading ? 'border-gray-300 dark:border-slate-600 cursor-not-allowed' : 'border-gray-300 dark:border-slate-600 hover:border-primary-500 dark:hover:border-primary-400 cursor-pointer'
                                }`}
                            onDragOver={(e) => {
                                e.preventDefault();
                                if (!uploading) e.currentTarget.classList.add('border-primary-500');
                            }}
                            onDragLeave={(e) => {
                                e.currentTarget.classList.remove('border-primary-500');
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.currentTarget.classList.remove('border-primary-500');
                                if (!uploading && e.dataTransfer.files.length > 0) {
                                    handleUpload(e.dataTransfer.files);
                                }
                            }}
                        >
                            {uploading ? (
                                <div className="space-y-4">
                                    <RefreshCw className="h-12 w-12 text-primary-500 animate-spin mx-auto" />
                                    <p className="text-gray-600 dark:text-slate-400 font-medium">Uploading...</p>
                                    {uploadProgress && (
                                        <p className="text-sm text-gray-500 dark:text-slate-500">{uploadProgress}</p>
                                    )}
                                </div>
                            ) : (
                                <>
                                    <p className="text-lg text-gray-600 dark:text-slate-400 mb-8 font-medium">
                                        Drag and drop files here to upload
                                    </p>
                                    <button
                                        onClick={() => document.getElementById('sidebar-file-input')?.click()}
                                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors flex items-center gap-2"
                                    >
                                        <Upload className="h-4 w-4" />
                                        Upload Files
                                    </button>
                                    <input
                                        id="sidebar-file-input"
                                        type="file"
                                        multiple
                                        className="hidden"
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files.length > 0) {
                                                handleUpload(e.target.files);
                                            }
                                        }}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                }
            />

            {/* Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={deleteConfirm.isOpen}
                onClose={() => setDeleteConfirm({ isOpen: false, fileId: null, fileName: null })}
                onConfirm={handleDeleteConfirm}
                title="Delete File"
                message={`Are you sure you want to delete "${deleteConfirm.fileName}"? This action cannot be undone.`}
                confirmText="Delete"
                isDangerous={true}
            />

            {/* Toast Notifications */}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </>
    );
}
