import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { textEditor, type Column, type RenderEditCellProps } from 'react-data-grid';
import { FolderOpen } from 'lucide-react';
import {
    listBucketsStorageBucketsGet,
    createBucketStorageBucketsPost,
    updateBucketStorageBucketsBucketIdPatch,
    deleteBucketStorageBucketsBucketIdDelete,
} from '../client/sdk.gen';
import type { BucketResponse } from '../client/types.gen';
import { useAuth } from '../context/AuthContext';
import { API_KEY } from '../lib/api';
import {
    Modal,
    Input,
    Textarea,
    Checkbox,
    Label,
    DataTable,
    type DataTableApi,
    type SortOption,
    type ExportConfig,
} from '../components';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../lib/useToast';
import { stripName, getErrorMessage, hasError } from '../lib/utils';
import { formatDate } from '../lib/formatDate';

type BucketRow = BucketResponse;

const PAGE_SIZE = 50;

// Sort options for the dropdown
const SORT_OPTIONS: SortOption[] = [
    { value: 'created_at', label: 'Created Date' },
    { value: 'updated_at', label: 'Updated Date' },
    { value: 'name', label: 'Name' },
];

// Export configuration
const EXPORT_CONFIG: ExportConfig = {
    columns: [
        { key: 'id', name: 'ID' },
        { key: 'name', name: 'Name' },
        { key: 'description', name: 'Description' },
        { key: 'public', name: 'Public' },
        { key: 'file_count', name: 'Files' },
        { key: 'total_size', name: 'Size' },
        { key: 'created_at', name: 'Created At' },
        { key: 'updated_at', name: 'Updated At' },
    ],
    filename: 'buckets.csv',
};

// Format file size for display
function formatSize(bytes: number | undefined): string {
    if (bytes === undefined || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function Storage() {
    const { token } = useAuth();
    const navigate = useNavigate();
    const { toasts, dismissToast, showSuccess, showError } = useToast();

    // Create modal state
    const [createForm, setCreateForm] = useState({
        name: '',
        description: '',
        public: false,
    });

    // API operations for DataTable
    const api: DataTableApi<BucketRow> = useMemo(() => ({
        fetch: async ({ page, pageSize, search, sortBy, sortOrder }) => {
            if (!token) {
                return { data: [], hasMore: false };
            }

            const skip = (page - 1) * pageSize;
            const response = await listBucketsStorageBucketsGet({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                query: {
                    skip,
                    limit: pageSize,
                    search: search || undefined,
                    sort_by: sortBy as 'created_at' | 'updated_at' | 'name' | undefined,
                    sort_order: sortOrder,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            return {
                data: response.data || [],
                hasMore: (response.data?.length || 0) === pageSize,
            };
        },

        update: async (id, data) => {
            const response = await updateBucketStorageBucketsBucketIdPatch({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    bucket_id: id,
                },
                body: {
                    description: data.description || null,
                    public: data.public,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            return response.data as BucketRow;
        },

        delete: async (id) => {
            const response = await deleteBucketStorageBucketsBucketIdDelete({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    bucket_id: id,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }
        },
    }), [token]);

    // Column definitions with inline editing
    const columns: Column<BucketRow>[] = useMemo(() => [

        {
            key: 'name',
            name: 'Name',
            resizable: true,
            minWidth: 200,
            renderCell: ({ row }) => (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/storage/${row.id}`);
                    }}
                    className="flex items-center gap-2 hover:text-primary-400 transition-colors"
                >
                    <FolderOpen className="h-4 w-4 text-primary-400" />
                    <span className="font-medium">{row.name}</span>
                </button>
            ),
        },
        {
            key: 'description',
            name: 'Description',
            resizable: true,
            minWidth: 200,
            renderCell: ({ row }) => row.description || <span className="text-gray-500 dark:text-slate-500">No description</span>,
            renderEditCell: textEditor
        },
        {
            key: 'public',
            name: 'Visibility',
            resizable: true,
            minWidth: 120,
            renderCell: ({ row }) => (
                <span
                    className={`px-2 py-1 rounded-full text-xs ${row.public ? 'bg-green-500/10 text-green-600 dark:text-green-400' : 'bg-gray-500/10 dark:bg-slate-500/10 text-gray-500 dark:text-slate-400'
                        }`}
                >
                    {row.public ? 'Public' : 'Private'}
                </span>
            ),
            renderEditCell: ({ row, onRowChange }: RenderEditCellProps<BucketRow>) => (
                <select
                    className="w-full h-full px-2 bg-white dark:bg-slate-800 border-0 text-gray-900 dark:text-white focus:outline-none"
                    value={row.public ? 'true' : 'false'}
                    onChange={(e) => onRowChange({ ...row, public: e.target.value === 'true' }, true)}
                    autoFocus
                >
                    <option value="true">Public</option>
                    <option value="false">Private</option>
                </select>
            )
        },
        {
            key: 'file_count',
            name: 'Files',
            resizable: true,
            minWidth: 80,
            renderCell: ({ row }) => row.file_count ?? 0
        },
        {
            key: 'total_size',
            name: 'Size',
            resizable: true,
            minWidth: 100,
            renderCell: ({ row }) => formatSize(row.total_size)
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
        {
            key: 'updated_at',
            name: 'Updated At',
            resizable: true,
            minWidth: 180,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {formatDate(row.updated_at)}
                </span>
            )
        },
    ], [navigate]);

    // Handle create bucket form submission
    const handleCreateBucket = async (onSuccess: () => void) => {
        const bucketName = stripName(createForm.name);
        if (!bucketName) {
            showError('Bucket name cannot be empty');
            return;
        }

        try {
            const response = await createBucketStorageBucketsPost({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                body: {
                    name: bucketName,
                    description: stripName(createForm.description) || null,
                    public: createForm.public,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            setCreateForm({
                name: '',
                description: '',
                public: false,
            });
            showSuccess('Bucket created successfully');
            onSuccess();
        } catch (error) {
            showError(getErrorMessage(error));
        }
    };

    return (
        <>
            <DataTable<BucketRow>
                columns={columns}
                api={api}
                title="Storage Buckets"
                entityName="bucket"
                sortOptions={SORT_OPTIONS}
                exportConfig={EXPORT_CONFIG}
                pageSize={PAGE_SIZE}
                defaultSortBy="created_at"
                defaultSortOrder="desc"
                searchPlaceholder="Search by name or description..."
                createButtonLabel="Create Bucket"
                emptyMessage="No buckets found"
                loadingMessage="Loading buckets..."
                renderCreateModal={({ isOpen, onClose, onSuccess }) => (
                    <Modal
                        isOpen={isOpen}
                        onClose={onClose}
                        title="Create New Bucket"
                    >
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                handleCreateBucket(onSuccess);
                            }}
                            className="space-y-4"
                        >
                            <div>
                                <Label>Bucket Name</Label>
                                <Input
                                    type="text"
                                    required
                                    value={createForm.name}
                                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                                    placeholder="e.g., images, documents, uploads"
                                    hint="A unique name for your storage bucket"
                                />
                            </div>
                            <div>
                                <Label>Description</Label>
                                <Textarea
                                    value={createForm.description}
                                    onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                                    rows={2}
                                    placeholder="Optional description for this bucket"
                                />
                            </div>
                            <Checkbox
                                id="public"
                                checked={createForm.public}
                                onChange={(e) => setCreateForm({ ...createForm, public: e.target.checked })}
                                label="Public (files accessible to everyone)"
                            />

                            <div className="flex justify-end gap-2 pt-4">
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-transparent text-gray-700 dark:text-white rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors"
                                >
                                    Create Bucket
                                </button>
                            </div>
                        </form>
                    </Modal>
                )}
            />

            {/* Toast Notifications */}
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        </>
    );
}
