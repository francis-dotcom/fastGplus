import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { type Column } from 'react-data-grid';
import {
    Code,
    Trash2,
    Plus,
    Eye,
    EyeOff,
    AlertCircle,
    CheckCircle,
    Clock,
    Webhook,
    Activity,
    RefreshCw,
    Copy,
    ArrowLeft,
} from 'lucide-react';
import {
    getFunctionFunctionsFunctionIdGet,
    updateFunctionFunctionsFunctionIdPatch,
    deleteFunctionFunctionsFunctionIdDelete,
    updateFunctionEnvVarsFunctionsFunctionIdEnvPut,
    listFunctionExecutionsFunctionsFunctionIdExecutionsGet,
    listWebhooksWebhooksGet,
    createWebhookWebhooksPost,
    deleteWebhookWebhooksWebhookIdDelete,
} from '../client/sdk.gen';
import type { FunctionRead, FunctionExecutionRead, WebhookRead, WebhookCreate } from '../client/types.gen';
import { useAuth } from '../context/AuthContext';
import { API_KEY } from '../lib/api';
import {
    Modal,
    ConfirmationModal,
    Input,
    Textarea,
    Label,
    Select,
    DataTable,
    FunctionCodeEditor,
    DEFAULT_FUNCTION_CODE,
    type DataTableApi,
    type SortOption,
    type ExportConfig,
    type FunctionCodeFormState,
} from '../components';
import { ToastContainer } from '../components/Toast';
import { useToast } from '../lib/useToast';
import { getErrorMessage, hasError, stripName } from '../lib/utils';
import { formatDate } from '../lib/formatDate';

// Tab type
type TabType = 'overview' | 'code' | 'webhooks';

// Execution row type
type ExecutionRow = FunctionExecutionRead;

// Webhook row type
type WebhookRow = WebhookRead;

// Status badge component
function StatusBadge({ status }: { status: string }) {
    const statusConfig: Record<string, { icon: typeof CheckCircle; className: string }> = {
        deployed: { icon: CheckCircle, className: 'bg-green-500/10 text-green-600 dark:text-green-400' },
        pending: { icon: Clock, className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
        failed: { icon: AlertCircle, className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
        not_deployed: { icon: Clock, className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
        completed: { icon: CheckCircle, className: 'bg-green-500/10 text-green-600 dark:text-green-400' },
        running: { icon: Clock, className: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 animate-pulse' },
        error: { icon: AlertCircle, className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
        success: { icon: CheckCircle, className: 'bg-green-500/10 text-green-600 dark:text-green-400' },
    };

    const config = statusConfig[status] || statusConfig.pending;
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${config.className}`}>
            <Icon className="h-3 w-3" />
            {status.replace('_', ' ')}
        </span>
    );
}

// Resolve public webhook base strictly from build-time env (no fallback)
const WEBHOOK_BASE_URL = (() => {
    const explicit = import.meta.env.VITE_PUBLIC_WEBHOOK_URL as string | undefined;
    if (!explicit) {
        throw new Error('VITE_PUBLIC_WEBHOOK_URL is required to render webhook URLs');
    }

    const resolved = new URL(explicit, window.location.origin).toString();
    return resolved.replace(/\/$/, '');
})();

// Webhook providers for dropdown
const WEBHOOK_PROVIDERS = [
    { value: '', label: 'Custom / Generic' },
    { value: 'stripe', label: 'Stripe' },
    { value: 'github', label: 'GitHub' },
    { value: 'slack', label: 'Slack' },
    { value: 'shopify', label: 'Shopify' },
    { value: 'twilio', label: 'Twilio' },
    { value: 'sendgrid', label: 'SendGrid' },
    { value: 'mailgun', label: 'Mailgun' },
    { value: 'paddle', label: 'Paddle' },
    { value: 'lemonsqueezy', label: 'Lemon Squeezy' },
];

// Execution sort options
const EXECUTION_SORT_OPTIONS: SortOption[] = [
    { value: 'started_at', label: 'Started' },
    { value: 'completed_at', label: 'Completed' },
    { value: 'duration_ms', label: 'Duration' },
    { value: 'status', label: 'Status' },
];

// Execution export config
const EXECUTION_EXPORT_CONFIG: ExportConfig = {
    columns: [
        { key: 'id', name: 'Execution ID' },
        { key: 'trigger_type', name: 'Trigger' },
        { key: 'status', name: 'Status' },
        { key: 'started_at', name: 'Started' },
        { key: 'completed_at', name: 'Completed' },
        { key: 'duration_ms', name: 'Duration (ms)' },
    ],
    filename: 'function-executions.csv',
};

// Webhook sort options
const WEBHOOK_SORT_OPTIONS: SortOption[] = [
    { value: 'created_at', label: 'Created Date' },
    { value: 'name', label: 'Name' },
    { value: 'last_received_at', label: 'Last Received' },
];

// Webhook export config
const WEBHOOK_EXPORT_CONFIG: ExportConfig = {
    columns: [
        { key: 'id', name: 'ID' },
        { key: 'name', name: 'Name' },
        { key: 'provider', name: 'Provider' },
        { key: 'is_active', name: 'Active' },
        { key: 'total_delivery_count', name: 'Total Deliveries' },
        { key: 'created_at', name: 'Created At' },
    ],
    filename: 'webhooks.csv',
};

const PAGE_SIZE = 50;

export default function FunctionDetail() {
    const { functionId } = useParams<{ functionId: string }>();
    const navigate = useNavigate();
    const { token } = useAuth();
    const { toasts, dismissToast, showSuccess, showError } = useToast();

    // Function state
    const [func, setFunc] = useState<FunctionRead | null>(null);
    const [loading, setLoading] = useState(true);

    // Active tab
    const [activeTab, setActiveTab] = useState<TabType>('overview');

    // Code editor state
    const [codeForm, setCodeForm] = useState<FunctionCodeFormState>({
        code: '',
        description: '',
        timeout_seconds: 30,
        env_vars: [],
    });
    const [hasCodeChanges, setHasCodeChanges] = useState(false);
    const [savingCode, setSavingCode] = useState(false);

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Webhook modal state
    const [isWebhookModalOpen, setIsWebhookModalOpen] = useState(false);
    const [webhookForm, setWebhookForm] = useState<{
        name: string;
        description: string;
        provider: string;
        provider_event_type: string;
        secret_key: string;
        rate_limit_per_minute: number;
        retry_attempts: number;
        showSecret: boolean;
    }>({
        name: '',
        description: '',
        provider: '',
        provider_event_type: '',
        secret_key: '',
        rate_limit_per_minute: 100,
        retry_attempts: 3,
        showSecret: false,
    });
    const [creatingWebhook, setCreatingWebhook] = useState(false);

    // Webhook delete confirmation
    const [webhookDeleteConfirm, setWebhookDeleteConfirm] = useState<{
        isOpen: boolean;
        webhookId: string | null;
        webhookName: string | null;
    }>({
        isOpen: false,
        webhookId: null,
        webhookName: null,
    });

    // Refresh key for DataTables
    const [refreshKey, setRefreshKey] = useState(0);

    // Fetch function details
    const fetchFunction = useCallback(async () => {
        if (!token || !functionId) return;

        try {
            setLoading(true);
            const response = await getFunctionFunctionsFunctionIdGet({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    function_id: functionId,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            if (response.data) {
                setFunc(response.data);
                // Initialize code form
                const envVarsArray = response.data.env_vars
                    ? Object.entries(response.data.env_vars).map(([key, value]) => ({
                        key,
                        value: String(value),
                        visible: false,
                    }))
                    : [];
                setCodeForm({
                    code: response.data.code || DEFAULT_FUNCTION_CODE,
                    description: response.data.description || '',
                    timeout_seconds: response.data.timeout_seconds || 30,
                    env_vars: envVarsArray,
                });
                setHasCodeChanges(false);
            }
        } catch (error) {
            console.error('Failed to fetch function:', error);
            showError(getErrorMessage(error));
        } finally {
            setLoading(false);
        }
    }, [token, functionId, showError]);

    useEffect(() => {
        fetchFunction();
    }, [fetchFunction]);

    // Handle save code
    const handleSaveCode = async () => {
        if (!token || !functionId || savingCode) return;

        setSavingCode(true);
        try {
            // Update function code and description
            const updateResponse = await updateFunctionFunctionsFunctionIdPatch({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    function_id: functionId,
                },
                body: {
                    code: codeForm.code,
                    description: codeForm.description || null,
                    timeout_seconds: codeForm.timeout_seconds,
                },
            });

            if (hasError(updateResponse)) {
                throw new Error(getErrorMessage(updateResponse.error));
            }

            // Update env vars
            const envVarsObj: Record<string, string> = {};
            for (const env of codeForm.env_vars) {
                if (env.key.trim()) {
                    envVarsObj[env.key.trim()] = env.value;
                }
            }

            const envResponse = await updateFunctionEnvVarsFunctionsFunctionIdEnvPut({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    function_id: functionId,
                },
                body: {
                    env_vars: envVarsObj,
                },
            });

            if (hasError(envResponse)) {
                throw new Error(getErrorMessage(envResponse.error));
            }

            showSuccess('Function saved successfully');
            setHasCodeChanges(false);
            fetchFunction();
        } catch (error) {
            showError(getErrorMessage(error));
        } finally {
            setSavingCode(false);
        }
    };

    // Handle delete function
    const handleDelete = async () => {
        if (!token || !functionId || deleting) return;

        setDeleting(true);
        try {
            const response = await deleteFunctionFunctionsFunctionIdDelete({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    function_id: functionId,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            showSuccess('Function deleted successfully');
            navigate('/functions');
        } catch (error) {
            showError(getErrorMessage(error));
        } finally {
            setDeleting(false);
            setDeleteConfirm(false);
        }
    };

    // Handle code form change with tracking changes
    const handleCodeFormChange = (newState: FunctionCodeFormState) => {
        setCodeForm(newState);
        setHasCodeChanges(true);
    };

    // Handle create webhook
    const handleCreateWebhook = async () => {
        if (!token || !functionId || creatingWebhook) return;

        const webhookName = stripName(webhookForm.name);
        if (!webhookName) {
            showError('Webhook name cannot be empty');
            return;
        }

        if (!webhookForm.secret_key.trim()) {
            showError('Secret key is required');
            return;
        }

        setCreatingWebhook(true);
        try {
            const body: WebhookCreate = {
                function_id: functionId,
                name: webhookName,
                description: webhookForm.description || undefined,
                secret_key: webhookForm.secret_key,
                provider: webhookForm.provider || undefined,
                provider_event_type: webhookForm.provider_event_type || undefined,
                rate_limit_per_minute: webhookForm.rate_limit_per_minute,
                retry_attempts: webhookForm.retry_attempts,
            };

            const response = await createWebhookWebhooksPost({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                body,
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            showSuccess('Webhook created successfully');
            setIsWebhookModalOpen(false);
            setWebhookForm({
                name: '',
                description: '',
                provider: '',
                provider_event_type: '',
                secret_key: '',
                rate_limit_per_minute: 100,
                retry_attempts: 3,
                showSecret: false,
            });
            setRefreshKey(prev => prev + 1);
        } catch (error) {
            showError(getErrorMessage(error));
        } finally {
            setCreatingWebhook(false);
        }
    };

    // Handle delete webhook
    const handleDeleteWebhook = async () => {
        if (!token || !webhookDeleteConfirm.webhookId) return;

        try {
            const response = await deleteWebhookWebhooksWebhookIdDelete({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    webhook_id: webhookDeleteConfirm.webhookId,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            showSuccess('Webhook deleted successfully');
            setRefreshKey(prev => prev + 1);
        } catch (error) {
            showError(getErrorMessage(error));
        } finally {
            setWebhookDeleteConfirm({ isOpen: false, webhookId: null, webhookName: null });
        }
    };

    // Copy to clipboard helper
    const copyToClipboard = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        showSuccess(`${label} copied to clipboard`);
    };

    // Execution API for DataTable
    const executionApi: DataTableApi<ExecutionRow> = useMemo(() => ({
        fetch: async ({ page, pageSize }) => {
            if (!token || !functionId) {
                return { data: [], hasMore: false };
            }

            const skip = (page - 1) * pageSize;
            const response = await listFunctionExecutionsFunctionsFunctionIdExecutionsGet({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    function_id: functionId,
                },
                query: {
                    offset: skip,
                    limit: pageSize,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            const executions = response.data?.executions || [];

            return {
                data: executions,
                hasMore: executions.length === pageSize,
            };
        },
        // Executions cannot be updated
        update: async () => {
            throw new Error('Executions cannot be updated');
        },
        // Executions cannot be deleted
        delete: async () => {
            throw new Error('Executions cannot be deleted');
        },
    }), [token, functionId]);

    // Execution columns
    const executionColumns: Column<ExecutionRow>[] = useMemo(() => [
        {
            key: 'row_number',
            name: '#',
            resizable: false,
            width: 50,
            renderCell: ({ rowIdx }) => (
                <span className="text-gray-500 dark:text-slate-500 text-sm">{rowIdx + 1}</span>
            ),
        },
        {
            key: 'id',
            name: 'Execution ID',
            resizable: true,
            minWidth: 120,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-xs font-mono truncate" title={row.id}>
                    {row.id.substring(0, 8)}...
                </span>
            ),
        },
        {
            key: 'trigger_type',
            name: 'Trigger',
            resizable: true,
            minWidth: 100,
            renderCell: ({ row }) => (
                <span className="text-gray-600 dark:text-slate-300 text-sm">
                    {row.trigger_type}
                </span>
            ),
        },
        {
            key: 'trigger_source',
            name: 'Trigger Source',
            resizable: true,
            minWidth: 250,
            renderCell: ({ row }) => {
                const triggerSource = (row.result as { trigger_source?: string } | null)?.trigger_source;
                return (
                    <span className="text-gray-500 dark:text-slate-400 text-xs font-mono truncate">
                        {triggerSource || row.function_id || '-'}
                    </span>
                );
            },
        },
        {
            key: 'status',
            name: 'Status',
            resizable: true,
            minWidth: 110,
            renderCell: ({ row }) => <StatusBadge status={row.status} />,
        },
        {
            key: 'started_at',
            name: 'Started',
            resizable: true,
            minWidth: 170,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {formatDate(row.started_at)}
                </span>
            ),
        },
        {
            key: 'completed_at',
            name: 'Completed',
            resizable: true,
            minWidth: 170,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {row.completed_at ? formatDate(row.completed_at) : '-'}
                </span>
            ),
        },
        {
            key: 'duration_ms',
            name: 'Duration',
            resizable: true,
            minWidth: 90,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {row.duration_ms ? `${row.duration_ms}ms` : '-'}
                </span>
            ),
        },
        {
            key: 'memory_mb',
            name: 'Memory (MB)',
            resizable: true,
            minWidth: 100,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {(row.result as any)?.memory_mb || 'N/A'}
                </span>
            ),
        },
        {
            key: 'cpu',
            name: 'CPU %',
            resizable: true,
            minWidth: 80,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {(row.result as any)?.cpu_percent || 'N/A'}
                </span>
            ),
        },
    ], []);

    // Webhook API for DataTable
    const webhookApi: DataTableApi<WebhookRow> = useMemo(() => ({
        fetch: async ({ page, pageSize }) => {
            if (!token || !functionId) {
                return { data: [], hasMore: false };
            }

            const skip = (page - 1) * pageSize;
            const response = await listWebhooksWebhooksGet({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                query: {
                    offset: skip,
                    limit: 100, // Max allowed by backend, filter client-side by function_id
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            // Filter webhooks by function_id client-side
            const allWebhooks = response.data?.webhooks || [];
            const webhooks = allWebhooks.filter(w => w.function_id === functionId);

            return {
                data: webhooks.slice(0, pageSize),
                hasMore: webhooks.length > pageSize,
            };
        },
        // Webhooks cannot be updated inline
        update: async () => {
            throw new Error('Webhooks cannot be updated inline');
        },
        delete: async (id) => {
            const response = await deleteWebhookWebhooksWebhookIdDelete({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    webhook_id: id,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }
        },
    }), [token, functionId]);

    // Webhook columns
    const webhookColumns: Column<WebhookRow>[] = useMemo(() => [
        {
            key: 'name',
            name: 'Name',
            resizable: true,
            minWidth: 150,
            renderCell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <Webhook className="h-4 w-4 text-purple-400" />
                    <span className="font-medium text-gray-900 dark:text-white">{row.name}</span>
                </div>
            ),
        },
        {
            key: 'provider',
            name: 'Provider',
            resizable: true,
            minWidth: 120,
            renderCell: ({ row }) => (
                <span className="text-gray-600 dark:text-slate-300 text-sm capitalize">
                    {row.provider || 'Custom'}
                </span>
            ),
        },
        {
            key: 'webhook_token',
            name: 'Webhook URL',
            resizable: true,
            minWidth: 300,
            renderCell: ({ row }) => {
                const webhookUrl = `${WEBHOOK_BASE_URL}/webhooks/trigger/${row.webhook_token}`;
                return (
                    <div className="flex items-center gap-2">
                        <span
                            className="text-gray-500 dark:text-slate-400 text-xs font-mono truncate max-w-[200px]"
                            title={`${webhookUrl}\nUse a publicly accessible backend URL in production.`}
                        >
                            {webhookUrl}
                        </span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(webhookUrl, 'Webhook URL');
                            }}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            title="Copy URL"
                        >
                            <Copy className="h-3 w-3" />
                        </button>
                    </div>
                );
            },
        },
        {
            key: 'is_active',
            name: 'Status',
            resizable: true,
            minWidth: 100,
            renderCell: ({ row }) => (
                <StatusBadge status={row.is_active ? 'deployed' : 'not_deployed'} />
            ),
        },
        {
            key: 'total_delivery_count',
            name: 'Deliveries',
            resizable: true,
            minWidth: 130,
            renderCell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <span className="text-gray-600 dark:text-slate-400">{row.total_delivery_count}</span>
                    {row.total_delivery_count > 0 && (
                        <span className="text-xs text-gray-500 dark:text-slate-500">
                            ({row.successful_delivery_count} ✓ / {row.failed_delivery_count} ✗)
                        </span>
                    )}
                </div>
            ),
        },
        {
            key: 'last_received_at',
            name: 'Last Received',
            resizable: true,
            minWidth: 170,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {row.last_received_at ? formatDate(row.last_received_at) : 'Never'}
                </span>
            ),
        },
        {
            key: 'created_at',
            name: 'Created',
            resizable: true,
            minWidth: 170,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {formatDate(row.created_at)}
                </span>
            ),
        },
        {
            key: 'actions',
            name: 'Actions',
            resizable: false,
            width: 80,
            renderCell: ({ row }) => (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setWebhookDeleteConfirm({
                            isOpen: true,
                            webhookId: row.id,
                            webhookName: row.name,
                        });
                    }}
                    className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                    title="Delete webhook"
                >
                    <Trash2 className="h-4 w-4" />
                </button>
            ),
        },
    ], []);

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
                <div className="flex items-center gap-2 text-gray-600 dark:text-slate-400">
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>Loading function...</span>
                </div>
            </div>
        );
    }

    if (!func) {
        return (
            <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Function not found</h2>
                    <p className="text-gray-600 dark:text-slate-400 mb-4">The function you're looking for doesn't exist or has been deleted.</p>
                    <button
                        onClick={() => navigate('/functions')}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors"
                    >
                        Back to Functions
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="h-[var(--page-content-height)] flex flex-col overflow-hidden">
            <ToastContainer toasts={toasts} onDismiss={dismissToast} />

            {/* Header */}
            <div className="mb-4 flex-shrink-0">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => navigate('/functions')}
                                className="p-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                                title="Back to Functions"
                            >
                                <ArrowLeft className="h-5 w-5" />
                            </button>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                                {func.name}
                            </h1>
                        </div>
                        <p className="text-gray-500 dark:text-slate-400 ml-11">
                            {func.description || 'No description'}
                        </p>
                    </div>
                    <button
                        onClick={() => setDeleteConfirm(true)}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors flex items-center gap-2"
                    >
                        <Trash2 className="h-4 w-4" />
                        Delete Function
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 flex-1 min-h-0 flex flex-col">
                <div className="border-b border-gray-200 dark:border-slate-700">
                    <nav className="flex gap-4 px-6" aria-label="Tabs">
                        <button
                            onClick={() => setActiveTab('overview')}
                            className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${activeTab === 'overview'
                                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <Activity className="h-4 w-4" />
                                Overview
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('code')}
                            className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${activeTab === 'code'
                                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <Code className="h-4 w-4" />
                                Code
                                {hasCodeChanges && (
                                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                                )}
                            </span>
                        </button>
                        <button
                            onClick={() => setActiveTab('webhooks')}
                            className={`py-4 px-2 border-b-2 font-medium text-sm transition-colors ${activeTab === 'webhooks'
                                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 hover:border-gray-300 dark:hover:border-slate-600'
                                }`}
                        >
                            <span className="flex items-center gap-2">
                                <Webhook className="h-4 w-4" />
                                Webhooks
                            </span>
                        </button>
                    </nav>
                </div>

                {/* Tab Content */}
                <div className="p-4 flex-1 min-h-0 flex flex-col">
                    {/* Overview Tab - Function Executions */}
                    {activeTab === 'overview' && (
                        <div className="flex-1 min-h-0 flex flex-col">
                            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                Function Executions
                            </h2>
                            <div className="flex-1 min-h-0">
                                <DataTable<ExecutionRow>
                                    key={`executions-${refreshKey}`}
                                    columns={executionColumns}
                                    api={executionApi}
                                    title=""
                                    entityName="execution"
                                    sortOptions={EXECUTION_SORT_OPTIONS}
                                    exportConfig={EXECUTION_EXPORT_CONFIG}
                                    pageSize={PAGE_SIZE}
                                    defaultSortBy="started_at"
                                    defaultSortOrder="desc"
                                    searchPlaceholder="Search executions..."
                                    emptyMessage="No executions found"
                                    loadingMessage="Loading executions..."
                                    showRefreshInline={true}
                                    gridHeight="100%"
                                />
                            </div>
                        </div>
                    )}

                    {/* Code Tab */}
                    {activeTab === 'code' && (
                        <FunctionCodeEditor
                            formState={codeForm}
                            onFormChange={handleCodeFormChange}
                            functionName={func.name}
                            isEditMode={true}
                            hasChanges={hasCodeChanges}
                            isSaving={savingCode}
                            onSave={handleSaveCode}
                            submitLabel="Save Changes"
                            fillHeight={true}
                            rightPanelWidth="w-[420px]"
                        />
                    )}

                    {/* Webhooks Tab */}
                    {activeTab === 'webhooks' && (
                        <div className="flex-1 min-h-0 flex flex-col">
                            <div className="flex items-center justify-between flex-shrink-0">
                                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                                    Webhooks
                                </h2>
                                <button
                                    onClick={() => setIsWebhookModalOpen(true)}
                                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors flex items-center gap-2"
                                >
                                    <Plus className="h-4 w-4" />
                                    Add Webhook
                                </button>
                            </div>
                            <div className="flex-1 min-h-0">
                                <DataTable<WebhookRow>
                                    key={`webhooks-${refreshKey}`}
                                    columns={webhookColumns}
                                    api={webhookApi}
                                    title=""
                                    entityName="webhook"
                                    sortOptions={WEBHOOK_SORT_OPTIONS}
                                    exportConfig={WEBHOOK_EXPORT_CONFIG}
                                    pageSize={PAGE_SIZE}
                                    defaultSortBy="created_at"
                                    defaultSortOrder="desc"
                                    searchPlaceholder="Search webhooks..."
                                    emptyMessage="No webhooks found"
                                    loadingMessage="Loading webhooks..."
                                    showRefreshInline={true}
                                    gridHeight="100%"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Delete Function Confirmation Modal */}
            <ConfirmationModal
                isOpen={deleteConfirm}
                onClose={() => setDeleteConfirm(false)}
                onConfirm={handleDelete}
                title="Delete Function"
                message={`Are you sure you want to delete the function "${func.name}"?`}
                confirmText="Delete"
                isDangerous={true}
            />

            {/* Delete Webhook Confirmation Modal */}
            <ConfirmationModal
                isOpen={webhookDeleteConfirm.isOpen}
                onClose={() => setWebhookDeleteConfirm({ isOpen: false, webhookId: null, webhookName: null })}
                onConfirm={handleDeleteWebhook}
                title="Delete Webhook"
                message={`Are you sure you want to delete the webhook "${webhookDeleteConfirm.webhookName}"?`}
                confirmText="Delete"
                isDangerous={true}
            />

            {/* Create Webhook Modal */}
            <Modal
                isOpen={isWebhookModalOpen}
                onClose={() => setIsWebhookModalOpen(false)}
                title="Create New Webhook"
                size="lg"
            >
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleCreateWebhook();
                    }}
                    className="space-y-4"
                >
                    <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                        Create a new webhook to trigger your function.
                    </p>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Webhook Name</Label>
                            <Input
                                type="text"
                                required
                                value={webhookForm.name}
                                onChange={(e) => setWebhookForm({ ...webhookForm, name: e.target.value })}
                                placeholder="my-webhook"
                            />
                        </div>
                        <div>
                            <Label>Function</Label>
                            <Input
                                type="text"
                                value={func.id}
                                disabled
                                className="bg-gray-100 dark:bg-slate-700 font-mono text-xs"
                            />
                        </div>
                    </div>

                    <div>
                        <Label>Description (Optional)</Label>
                        <Textarea
                            value={webhookForm.description}
                            onChange={(e) => setWebhookForm({ ...webhookForm, description: e.target.value })}
                            rows={2}
                            placeholder="Describe what this webhook does"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Provider (Optional)</Label>
                            <Select
                                value={webhookForm.provider}
                                onChange={(e) => setWebhookForm({ ...webhookForm, provider: e.target.value })}
                            >
                                {WEBHOOK_PROVIDERS.map((provider) => (
                                    <option key={provider.value} value={provider.value}>
                                        {provider.label}
                                    </option>
                                ))}
                            </Select>
                        </div>
                        <div>
                            <Label>Event Type (Optional)</Label>
                            <Input
                                type="text"
                                value={webhookForm.provider_event_type}
                                onChange={(e) => setWebhookForm({ ...webhookForm, provider_event_type: e.target.value })}
                                placeholder="checkout.session.completed"
                            />
                        </div>
                    </div>

                    <div>
                        <Label>Source URL (Optional)</Label>
                        <Input
                            type="url"
                            placeholder="https://api.stripe.com/webhooks"
                            hint="The source URL for documentation reference"
                        />
                    </div>

                    <div>
                        <Label>Secret Key</Label>
                        <div className="relative">
                            <Input
                                type={webhookForm.showSecret ? 'text' : 'password'}
                                required
                                value={webhookForm.secret_key}
                                onChange={(e) => setWebhookForm({ ...webhookForm, secret_key: e.target.value })}
                                placeholder="Enter HMAC secret key"
                                className="pr-10"
                            />
                            <button
                                type="button"
                                onClick={() => setWebhookForm({ ...webhookForm, showSecret: !webhookForm.showSecret })}
                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                            >
                                {webhookForm.showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label>Rate Limit (per minute)</Label>
                            <Input
                                type="number"
                                min={1}
                                max={10000}
                                value={webhookForm.rate_limit_per_minute}
                                onChange={(e) => setWebhookForm({ ...webhookForm, rate_limit_per_minute: parseInt(e.target.value) || 100 })}
                            />
                        </div>
                        <div>
                            <Label>Retry Attempts</Label>
                            <Input
                                type="number"
                                min={0}
                                max={10}
                                value={webhookForm.retry_attempts}
                                onChange={(e) => setWebhookForm({ ...webhookForm, retry_attempts: parseInt(e.target.value) || 3 })}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={() => setIsWebhookModalOpen(false)}
                            className="px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-transparent text-gray-700 dark:text-white rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={creatingWebhook}
                            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {creatingWebhook ? (
                                <Clock className="h-4 w-4 animate-spin" />
                            ) : (
                                <Webhook className="h-4 w-4" />
                            )}
                            Create Webhook
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
}
