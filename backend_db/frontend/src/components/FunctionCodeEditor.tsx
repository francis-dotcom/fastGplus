import { Plus, Trash2, Eye, EyeOff, Code, Clock } from 'lucide-react';
import Editor from '@monaco-editor/react';
import { Input, Textarea, Label } from './index';

// Environment variable type
export interface EnvVar {
    key: string;
    value: string;
    visible: boolean;
}

// Form state type
export interface FunctionCodeFormState {
    code: string;
    description: string;
    timeout_seconds: number;
    env_vars: EnvVar[];
}

// Props for the component
export interface FunctionCodeEditorProps {
    /** Current form state */
    formState: FunctionCodeFormState;
    /** Callback when form state changes */
    onFormChange: (newState: FunctionCodeFormState) => void;
    /** Function name (optional, shown as disabled field in edit mode) */
    functionName?: string;
    /** Whether this is edit mode (function name cannot be changed) */
    isEditMode?: boolean;
    /** Callback for name change in create mode */
    onNameChange?: (name: string) => void;
    /** Name value in create mode */
    name?: string;
    /** Whether there are unsaved changes (for edit mode) */
    hasChanges?: boolean;
    /** Whether save is in progress */
    isSaving?: boolean;
    /** Callback for save action (edit mode) */
    onSave?: () => void;
    /** Callback for cancel action */
    onCancel?: () => void;
    /** Callback for submit action (create mode) */
    onSubmit?: () => void;
    /** Submit button label */
    submitLabel?: string;
    /** Cancel button label */
    cancelLabel?: string;
    /** Whether the editor should fill available height */
    fillHeight?: boolean;
    /** Custom height for the editor container */
    height?: string;
    /** Right panel width */
    rightPanelWidth?: string;
    /** Show actions footer */
    showActions?: boolean;
}

// Default function template
export const DEFAULT_FUNCTION_CODE = `// SelfDB Serverless Function (Deno TypeScript)
// 
// This function receives a payload and returns a response.
// Available imports: Any Deno-compatible modules
//
// Example: Send email, process data, call external APIs, etc.

interface Payload {
  // Define your expected payload structure
  [key: string]: unknown;
}

interface Response {
  success: boolean;
  message: string;
  data?: unknown;
}

export default async function handler(payload: Payload): Promise<Response> {
  console.log('Function invoked with payload:', payload);
  
  // Your function logic here
  
  return {
    success: true,
    message: 'Function executed successfully',
    data: payload
  };
}
`;

export default function FunctionCodeEditor({
    formState,
    onFormChange,
    functionName,
    isEditMode = false,
    onNameChange,
    name,
    hasChanges = false,
    isSaving = false,
    onSave,
    onCancel,
    onSubmit,
    submitLabel = 'Save Changes',
    cancelLabel = 'Cancel',
    fillHeight = true,
    height = '100%',
    rightPanelWidth = 'w-[420px]',
    showActions = true,
}: FunctionCodeEditorProps) {
    // Environment variable management
    const handleAddEnvVar = () => {
        onFormChange({
            ...formState,
            env_vars: [...formState.env_vars, { key: '', value: '', visible: false }],
        });
    };

    const handleRemoveEnvVar = (index: number) => {
        const newEnvVars = formState.env_vars.filter((_, i) => i !== index);
        onFormChange({ ...formState, env_vars: newEnvVars });
    };

    const handleEnvVarChange = (index: number, field: 'key' | 'value', value: string) => {
        const newEnvVars = [...formState.env_vars];
        newEnvVars[index] = { ...newEnvVars[index], [field]: value };
        onFormChange({ ...formState, env_vars: newEnvVars });
    };

    const toggleEnvVarVisibility = (index: number) => {
        const newEnvVars = [...formState.env_vars];
        newEnvVars[index] = { ...newEnvVars[index], visible: !newEnvVars[index].visible };
        onFormChange({ ...formState, env_vars: newEnvVars });
    };

    const handleCodeChange = (value: string | undefined) => {
        onFormChange({ ...formState, code: value || '' });
    };

    const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onFormChange({ ...formState, description: e.target.value });
    };

    const handleTimeoutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onFormChange({ ...formState, timeout_seconds: parseInt(e.target.value) || 30 });
    };

    const containerClass = fillHeight 
        ? 'flex gap-6 flex-1 min-h-0' 
        : `flex gap-6 ${height !== '100%' ? '' : 'h-[600px]'}`;

    return (
        <div className={containerClass} style={!fillHeight && height !== '100%' ? { height } : undefined}>
            {/* Left side - Code Editor */}
            <div className="flex-1 min-w-0 flex flex-col">
                <Label className="mb-2">Function Code (TypeScript / Deno)</Label>
                <div className="flex-1 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <Editor
                        height="100%"
                        defaultLanguage="typescript"
                        value={formState.code}
                        onChange={handleCodeChange}
                        theme="vs-dark"
                        options={{
                            minimap: { enabled: false },
                            fontSize: 13,
                            lineNumbers: 'on',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            tabSize: 2,
                            wordWrap: 'on',
                            padding: { top: 10 },
                        }}
                    />
                </div>
            </div>

            {/* Right side - Form fields */}
            <div className={`${rightPanelWidth} shrink-0 flex flex-col`}>
                <div className="flex-1 overflow-y-auto space-y-4 px-1 pb-2">
                    {/* Function Name */}
                    <div>
                        <Label>Function Name</Label>
                        {isEditMode ? (
                            <>
                                <Input
                                    type="text"
                                    value={functionName || ''}
                                    disabled
                                    className="bg-gray-100 dark:bg-slate-700"
                                />
                                <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                                    Function names cannot be changed
                                </p>
                            </>
                        ) : (
                            <Input
                                type="text"
                                required
                                value={name || ''}
                                onChange={(e) => onNameChange?.(e.target.value)}
                                placeholder="e.g., send-email, process-data"
                                hint="Start with letter, use letters, numbers, hyphens, underscores"
                            />
                        )}
                    </div>

                    {/* Description */}
                    <div>
                        <Label>Description</Label>
                        <Textarea
                            value={formState.description}
                            onChange={handleDescriptionChange}
                            rows={2}
                            placeholder="What does this function do?"
                        />
                    </div>

                    {/* Timeout */}
                    <div>
                        <Label>Timeout (seconds)</Label>
                        <Input
                            type="number"
                            min={5}
                            max={300}
                            value={formState.timeout_seconds}
                            onChange={handleTimeoutChange}
                            hint="5-300 seconds"
                        />
                    </div>

                    {/* Environment Variables */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <Label className="mb-0">Environment Variables</Label>
                        </div>
                        <div className="space-y-3">
                            {formState.env_vars.map((env, index) => (
                                <div key={index} className="p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg border border-gray-200 dark:border-slate-700">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs text-gray-500 dark:text-slate-400 font-medium">Variable {index + 1}</span>
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveEnvVar(index)}
                                            className="p-1 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-colors"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="flex-1">
                                            <label className="text-xs text-gray-500 dark:text-slate-500 mb-1 block">Name</label>
                                            <Input
                                                type="text"
                                                value={env.key}
                                                onChange={(e) => handleEnvVarChange(index, 'key', e.target.value)}
                                                placeholder="API_KEY"
                                                className="font-mono text-sm"
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-xs text-gray-500 dark:text-slate-500 mb-1 block">Value</label>
                                            <div className="relative">
                                                <Input
                                                    type={env.visible ? 'text' : 'password'}
                                                    value={env.value}
                                                    onChange={(e) => handleEnvVarChange(index, 'value', e.target.value)}
                                                    placeholder="Secret value"
                                                    className="pr-10 font-mono text-sm"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => toggleEnvVarVisibility(index)}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
                                                >
                                                    {env.visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            onClick={handleAddEnvVar}
                            className="mt-2 w-full px-3 py-2 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-300 text-sm rounded-lg transition-colors flex items-center justify-center gap-1"
                        >
                            <Plus className="h-4 w-4" />
                            Add Environment Variable
                        </button>
                    </div>
                </div>

                {/* Actions Footer */}
                {showActions && (
                    <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-gray-200 dark:border-slate-700">
                        {onCancel && (
                            <button
                                type="button"
                                onClick={onCancel}
                                className="px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-transparent text-gray-700 dark:text-white rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                            >
                                {cancelLabel}
                            </button>
                        )}
                        {isEditMode && onSave ? (
                            <button
                                type="button"
                                onClick={onSave}
                                disabled={!hasChanges || isSaving}
                                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSaving ? (
                                    <Clock className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Code className="h-4 w-4" />
                                )}
                                {submitLabel}
                            </button>
                        ) : (
                            <button
                                type="submit"
                                onClick={onSubmit}
                                disabled={isSaving}
                                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-500 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSaving ? (
                                    <Clock className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Code className="h-4 w-4" />
                                )}
                                {submitLabel}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
