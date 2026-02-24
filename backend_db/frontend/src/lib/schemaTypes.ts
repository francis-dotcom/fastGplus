/**
 * Schema visualization types and utilities.
 * Re-exports types from the auto-generated SDK client.
 */

// Re-export types from the generated SDK
export type { 
  SchemaColumn, 
  SchemaNode, 
  SchemaEdge, 
  SchemaVisualizationResponse 
} from '../client/types.gen';

// Alias for backwards compatibility
export type SchemaData = import('../client/types.gen').SchemaVisualizationResponse;

// System tables that should be filtered out from visualization
const SYSTEM_TABLES = new Set([
  'alembic_version',
  'sql_history',
  'sql_snippets',
  'storage_buckets',
  'storage_objects',
  'pg_stat_statements',
  'tables_metadata',
]);

/**
 * Check if a table is a system table that should be hidden from visualization.
 */
export function isSystemTable(tableName: string): boolean {
  if (SYSTEM_TABLES.has(tableName)) {
    return true;
  }
  // Exclude pg_* and _* tables
  if (tableName.startsWith('pg_') || tableName.startsWith('_')) {
    return true;
  }
  return false;
}

// Local storage key for saving schema layout positions
const SCHEMA_LAYOUT_KEY = 'selfdb_schema_layout';

/**
 * Save schema node positions to localStorage.
 */
export function saveSchemaLayout(positions: Record<string, { x: number; y: number }>): void {
  try {
    localStorage.setItem(SCHEMA_LAYOUT_KEY, JSON.stringify(positions));
  } catch (e) {
    console.warn('Failed to save schema layout:', e);
  }
}

/**
 * Load schema node positions from localStorage.
 */
export function loadSchemaLayout(): Record<string, { x: number; y: number }> | null {
  try {
    const saved = localStorage.getItem(SCHEMA_LAYOUT_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Failed to load schema layout:', e);
  }
  return null;
}
