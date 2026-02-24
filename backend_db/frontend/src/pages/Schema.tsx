import { useState, useEffect, useCallback } from 'react';
import { SchemaVisualization } from '../components/schema';
import { getSchemaVisualizationSchemaVisualizationGet } from '../client/sdk.gen';
import type { SchemaVisualizationResponse } from '../client/types.gen';
import { API_KEY } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { GitBranch, AlertCircle } from 'lucide-react';

export default function Schema() {
  const { token } = useAuth();
  const [schemaData, setSchemaData] = useState<SchemaVisualizationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSchema = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await getSchemaVisualizationSchemaVisualizationGet({
        headers: {
          'X-API-Key': API_KEY,
          Authorization: `Bearer ${token}`,
        }
      });
      if (response.data) {
        setSchemaData(response.data);
      } else if (response.error) {
        const errorDetail = (response.error as { detail?: string })?.detail;
        setError(errorDetail || 'Failed to load schema');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schema');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchSchema();
  }, [fetchSchema]);

  return (
    <div className="h-[var(--page-content-height)] flex flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <GitBranch className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Schema Visualization
            </h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Visual representation of your database tables and relationships
            </p>
          </div>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      {/* Schema Visualization Container */}
      <div className="flex-1 bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
        {isLoading && !schemaData ? (
          <div className="h-full flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
              <p className="text-gray-500 dark:text-slate-400">Loading schema...</p>
            </div>
          </div>
        ) : schemaData ? (
          <SchemaVisualization
            data={schemaData}
            onRefresh={fetchSchema}
            isLoading={isLoading}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <GitBranch className="h-12 w-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-slate-400">No schema data available</p>
              <p className="text-sm text-gray-400 dark:text-slate-500 mt-1">
                Create some tables to see them here
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
