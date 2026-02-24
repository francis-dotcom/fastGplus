import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { textEditor, type Column } from 'react-data-grid';
import { Code, Play, Rocket, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import {
    listFunctionsFunctionsGet,
    createFunctionFunctionsPost,
    updateFunctionFunctionsFunctionIdPatch,
    deleteFunctionFunctionsFunctionIdDelete,
    deployFunctionFunctionsFunctionIdDeployPost,
} from '../client/sdk.gen';
import type { FunctionRead } from '../client/types.gen';
import { useAuth } from '../context/AuthContext';
import { API_KEY } from '../lib/api';
import {
    Modal,
    DataTable,
    FunctionCodeEditor,
    DEFAULT_FUNCTION_CODE,
    type DataTableApi,
    type SortOption,
    type ExportConfig,
    type FunctionCodeFormState,
} from '../components';
import { stripName, getErrorMessage, hasError } from '../lib/utils';
import { formatDate } from '../lib/formatDate';

type FunctionRow = FunctionRead;

const PAGE_SIZE = 50;

// Sort options for the dropdown
const SORT_OPTIONS: SortOption[] = [
    { value: 'created_at', label: 'Created Date' },
    { value: 'updated_at', label: 'Updated Date' },
    { value: 'name', label: 'Name' },
    { value: 'last_executed_at', label: 'Last Executed' },
    { value: 'execution_count', label: 'Execution Count' },
];

// Export configuration
const EXPORT_CONFIG: ExportConfig = {
    columns: [
        { key: 'id', name: 'ID' },
        { key: 'name', name: 'Name' },
        { key: 'description', name: 'Description' },
        { key: 'deployment_status', name: 'Status' },
        { key: 'version', name: 'Version' },
        { key: 'execution_count', name: 'Executions' },
        { key: 'created_at', name: 'Created At' },
        { key: 'updated_at', name: 'Updated At' },
    ],
    filename: 'functions.csv',
};

// Deployment status badge component
function StatusBadge({ status }: { status: string }) {
    const statusConfig: Record<string, { icon: typeof CheckCircle; className: string }> = {
        deployed: { icon: CheckCircle, className: 'bg-green-500/10 text-green-600 dark:text-green-400' },
        pending: { icon: Clock, className: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
        failed: { icon: AlertCircle, className: 'bg-red-500/10 text-red-600 dark:text-red-400' },
        not_deployed: { icon: Clock, className: 'bg-gray-500/10 text-gray-600 dark:text-gray-400' },
    };

    const config = statusConfig[status] || statusConfig.not_deployed;
    const Icon = config.icon;

    return (
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${config.className}`}>
            <Icon className="h-3 w-3" />
            {status.replace('_', ' ')}
        </span>
    );
}

export default function Functions() {
    const { token } = useAuth();
    const navigate = useNavigate();

    // Create modal state
    const [createName, setCreateName] = useState('');
    const [createFormState, setCreateFormState] = useState<FunctionCodeFormState>({
        code: DEFAULT_FUNCTION_CODE,
        description: '',
        timeout_seconds: 30,
        env_vars: [],
    });

    // Deploying state
    const [deployingId, setDeployingId] = useState<string | null>(null);

    // Handle deploy function
    const handleDeploy = useCallback(async (functionId: string, e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
        }
        
        if (!token || deployingId) return;
        
        setDeployingId(functionId);
        try {
            const response = await deployFunctionFunctionsFunctionIdDeployPost({
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

            // Trigger a refresh via window event
            window.dispatchEvent(new CustomEvent('datatable-refresh'));
        } catch (error) {
            alert(getErrorMessage(error));
        } finally {
            setDeployingId(null);
        }
    }, [token, deployingId]);

    // API operations for DataTable
    const api: DataTableApi<FunctionRow> = useMemo(() => ({
        fetch: async ({ page, pageSize, search, sortBy, sortOrder }) => {
            if (!token) {
                return { data: [], hasMore: false };
            }

            const skip = (page - 1) * pageSize;
            const response = await listFunctionsFunctionsGet({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                query: {
                    offset: skip,
                    limit: pageSize,
                    search: search || undefined,
                    sort_by: sortBy as 'created_at' | 'updated_at' | 'name' | 'last_executed_at' | 'execution_count' | undefined,
                    sort_order: sortOrder,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            const functions = response.data?.functions || [];
            
            return {
                data: functions,
                hasMore: functions.length === pageSize,
            };
        },

        update: async (id, data) => {
            const response = await updateFunctionFunctionsFunctionIdPatch({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    function_id: id,
                },
                body: {
                    description: data.description || null,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            return response.data as FunctionRow;
        },

        delete: async (id) => {
            const response = await deleteFunctionFunctionsFunctionIdDelete({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                path: {
                    function_id: id,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }
        },
    }), [token]);

    // Column definitions with inline editing
    const columns: Column<FunctionRow>[] = useMemo(() => [
        { 
            key: 'id', 
            name: 'ID', 
            resizable: true, 
            minWidth: 280,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-xs font-mono">
                    {row.id}
                </span>
            )
        },
        { 
            key: 'name', 
            name: 'Name', 
            resizable: true, 
            minWidth: 200,
            renderCell: ({ row }) => (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/functions/${row.id}`);
                    }}
                    className="flex items-center gap-2 hover:text-primary-400 transition-colors"
                >
                    <Code className="h-4 w-4 text-primary-400" />
                    <span className="font-medium">{row.name}</span>
                </button>
            ),
            renderEditCell: textEditor
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
            key: 'deployment_status', 
            name: 'Status', 
            resizable: true, 
            minWidth: 140,
            renderCell: ({ row }) => <StatusBadge status={row.deployment_status} />
        },
        { 
            key: 'version', 
            name: 'Version', 
            resizable: true, 
            minWidth: 80,
            renderCell: ({ row }) => (
                <span className="text-gray-600 dark:text-slate-400">v{row.version}</span>
            )
        },
        { 
            key: 'execution_count', 
            name: 'Executions', 
            resizable: true, 
            minWidth: 120,
            renderCell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <span className="text-gray-600 dark:text-slate-400">{row.execution_count}</span>
                    {row.execution_count > 0 && (
                        <span className="text-xs text-gray-500 dark:text-slate-500">
                            ({row.execution_success_count} ✓ / {row.execution_error_count} ✗)
                        </span>
                    )}
                </div>
            )
        },
        { 
            key: 'actions', 
            name: 'Actions', 
            resizable: false, 
            minWidth: 100,
            renderCell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => handleDeploy(row.id, e)}
                        disabled={deployingId === row.id}
                        title="Deploy function"
                        className="p-1.5 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded transition-colors disabled:opacity-50"
                    >
                        {deployingId === row.id ? (
                            <Clock className="h-4 w-4 animate-spin" />
                        ) : (
                            <Rocket className="h-4 w-4" />
                        )}
                    </button>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/functions/${row.id}`);
                        }}
                        title="View details"
                        className="p-1.5 text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded transition-colors"
                    >
                        <Play className="h-4 w-4" />
                    </button>
                </div>
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
        {
            key: 'last_executed_at',
            name: 'Last Executed',
            resizable: true,
            minWidth: 180,
            renderCell: ({ row }) => (
                <span className="text-gray-500 dark:text-slate-400 text-sm">
                    {row.last_executed_at ? formatDate(row.last_executed_at) : 'Never'}
                </span>
            )
        },
    ], [navigate, handleDeploy, deployingId]);

    // Handle create function form submission
    const handleCreateFunction = async (onSuccess: () => void) => {
        const functionName = stripName(createName);
        if (!functionName) {
            alert('Function name cannot be empty');
            return;
        }
        
        if (!createFormState.code.trim()) {
            alert('Function code cannot be empty');
            return;
        }

        // Validate env vars
        for (const env of createFormState.env_vars) {
            if (!env.key.trim()) {
                alert('Environment variable keys cannot be empty');
                return;
            }
        }
        
        try {
            // Build env vars object
            const envVarsObj: Record<string, string> = {};
            for (const env of createFormState.env_vars) {
                if (env.key.trim()) {
                    envVarsObj[env.key.trim()] = env.value;
                }
            }

            const response = await createFunctionFunctionsPost({
                headers: {
                    'X-API-Key': API_KEY,
                    Authorization: `Bearer ${token}`,
                },
                body: {
                    name: functionName,
                    description: stripName(createFormState.description) || null,
                    code: createFormState.code,
                    timeout_seconds: createFormState.timeout_seconds,
                    env_vars: Object.keys(envVarsObj).length > 0 ? envVarsObj : null,
                },
            });

            if (hasError(response)) {
                throw new Error(getErrorMessage(response.error));
            }

            // Reset form
            setCreateName('');
            setCreateFormState({
                code: DEFAULT_FUNCTION_CODE,
                description: '',
                timeout_seconds: 30,
                env_vars: [],
            });
            onSuccess();
        } catch (error) {
            alert(getErrorMessage(error));
        }
    };

    return (
        <DataTable<FunctionRow>
            columns={columns}
            api={api}
            title="Functions"
            entityName="function"
            sortOptions={SORT_OPTIONS}
            exportConfig={EXPORT_CONFIG}
            pageSize={PAGE_SIZE}
            defaultSortBy="created_at"
            defaultSortOrder="desc"
            searchPlaceholder="Search by name or description..."
            createButtonLabel="Create Function"
            emptyMessage="No functions found"
            loadingMessage="Loading functions..."
            renderCreateModal={({ isOpen, onClose, onSuccess }) => (
                <Modal
                    isOpen={isOpen}
                    onClose={onClose}
                    title="Create New Function"
                    size="full"
                >
                    <form 
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleCreateFunction(onSuccess);
                        }} 
                        className="h-[600px]"
                    >
                        <FunctionCodeEditor
                            formState={createFormState}
                            onFormChange={setCreateFormState}
                            name={createName}
                            onNameChange={setCreateName}
                            isEditMode={false}
                            onCancel={onClose}
                            submitLabel="Create Function"
                            cancelLabel="Cancel"
                            fillHeight={false}
                            height="600px"
                            rightPanelWidth="w-[420px]"
                        />
                    </form>
                </Modal>
            )}
        />
    );
}
