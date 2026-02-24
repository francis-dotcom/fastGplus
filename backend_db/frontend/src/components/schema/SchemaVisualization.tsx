import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  BackgroundVariant,
  MarkerType,
  BaseEdge,
} from '@xyflow/react';
import type { Edge, Node, EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { 
  isSystemTable, 
  loadSchemaLayout, 
  saveSchemaLayout 
} from '../../lib/schemaTypes';
import type { SchemaVisualizationResponse } from '../../client/types.gen';
import TableNode from './TableNode';
import { Download, Save, RefreshCw } from 'lucide-react';

// Constants for layout
const NODE_WIDTH = 240;
const HORIZONTAL_GAP = 60;      // Gap between columns
const VERTICAL_GAP = 30;        // Gap between stacked tables
const LARGE_TABLE_THRESHOLD = 8; // Tables with >= 8 fields get their own column
const CORRIDOR_OFFSET = 50;     // Distance of corridor from table bounds

// Primary blue color for edges
const EDGE_COLOR = '#2563eb';
const EDGE_COLOR_DIMMED = 'rgba(37, 99, 235, 0.15)';

// Calculate node height based on column count
const getNodeHeight = (columnCount: number) => Math.max(120, 50 + columnCount * 24);

// Custom Manhattan Edge - routes through top or bottom corridor with hover highlight
const ManhattanEdge: React.FC<EdgeProps> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  data,
}) => {
  const { getNodes, getEdges, setEdges } = useReactFlow();
  const nodes = getNodes();
  
  // Calculate bounds of all tables to determine corridor positions
  const bounds = React.useMemo(() => {
    let minY = Infinity;
    let maxY = -Infinity;
    
    nodes.forEach((node) => {
      const colCount = Array.isArray((node.data as { columns?: unknown[] })?.columns)
        ? ((node.data as { columns?: unknown[] })?.columns?.length ?? 4)
        : 4;
      const height = getNodeHeight(colCount);
      const top = node.position.y;
      const bottom = node.position.y + height;
      
      if (top < minY) minY = top;
      if (bottom > maxY) maxY = bottom;
    });
    
    return { minY, maxY };
  }, [nodes]);
  
  // Get edge index for corridor selection (from data)
  const edgeIndex = (data as { index?: number })?.index ?? 0;
  
  // Alternate between top and bottom corridor
  const useTopCorridor = edgeIndex % 2 === 0;
  
  // Calculate corridor Y position
  const corridorY = useTopCorridor 
    ? bounds.minY - CORRIDOR_OFFSET
    : bounds.maxY + CORRIDOR_OFFSET;
  
  // Build clean Manhattan path
  const stubLength = 15;
  const sourceGoingRight = sourceX < targetX;
  
  // Calculate path points for clean orthogonal routing
  const sourceStubX = sourceGoingRight ? sourceX + stubLength : sourceX - stubLength;
  const targetStubX = sourceGoingRight ? targetX - stubLength : targetX + stubLength;
  
  const pathD = `M ${sourceX} ${sourceY} L ${sourceStubX} ${sourceY} L ${sourceStubX} ${corridorY} L ${targetStubX} ${corridorY} L ${targetStubX} ${targetY} L ${targetX} ${targetY}`;
  
  // Handle hover - dim all other edges
  const handleMouseEnter = () => {
    const allEdges = getEdges();
    setEdges(allEdges.map(edge => {
      const isCurrentEdge = edge.id === id;
      return {
        ...edge,
        style: {
          stroke: isCurrentEdge ? EDGE_COLOR : EDGE_COLOR_DIMMED,
          strokeWidth: isCurrentEdge ? 3 : 1,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isCurrentEdge ? EDGE_COLOR : EDGE_COLOR_DIMMED,
        },
        zIndex: isCurrentEdge ? 1000 : 0,
      };
    }));
  };
  
  const handleMouseLeave = () => {
    const allEdges = getEdges();
    setEdges(allEdges.map(edge => ({
      ...edge,
      style: {
        stroke: EDGE_COLOR,
        strokeWidth: 3,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: EDGE_COLOR,
      },
      zIndex: 0,
    })));
  };
  
  return (
    <g
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: 'pointer' }}
    >
      {/* Invisible wider path for easier hover detection */}
      <path
        d={pathD}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
      />
      <BaseEdge
        id={id}
        path={pathD}
        markerEnd={markerEnd}
        style={{
          ...style,
          transition: 'stroke 0.2s, stroke-width 0.2s',
        }}
      />
    </g>
  );
};


// Custom centered layout: Users at center, tables spread left/right horizontally
const getCenteredLayout = (
  nodes: Node[],
  edges: Edge[]
): { nodes: Node[]; edges: Edge[] } => {
  // Find the users table (center piece)
  const usersNode = nodes.find(n => n.id.toLowerCase() === 'users');
  const otherNodes = nodes.filter(n => n.id.toLowerCase() !== 'users');
  
  // Count connections to users table for each node
  const connectionCount: Record<string, number> = {};
  edges.forEach(edge => {
    if (edge.source.toLowerCase() === 'users' || edge.target.toLowerCase() === 'users') {
      const otherNode = edge.source.toLowerCase() === 'users' ? edge.target : edge.source;
      connectionCount[otherNode] = (connectionCount[otherNode] || 0) + 1;
    }
  });
  
  // Sort by connection count (most connected first), then by column count
  const sortedNodes = [...otherNodes].sort((a, b) => {
    const aConnections = connectionCount[a.id] || 0;
    const bConnections = connectionCount[b.id] || 0;
    if (bConnections !== aConnections) return bConnections - aConnections;
    
    // Secondary sort by column count
    const aCount = (a.data as { columns?: unknown[] })?.columns?.length || 0;
    const bCount = (b.data as { columns?: unknown[] })?.columns?.length || 0;
    return bCount - aCount;
  });
  
  // Split into left and right sides (alternating to balance)
  const leftNodes: Node[] = [];
  const rightNodes: Node[] = [];
  
  sortedNodes.forEach((node, idx) => {
    if (idx % 2 === 0) {
      leftNodes.push(node);
    } else {
      rightNodes.push(node);
    }
  });
  
  // Position tracking
  const positions: Record<string, { x: number; y: number }> = {};
  
  // Center point of the canvas
  const centerX = 800;
  const centerY = 300;
  
  // Position users table at exact center
  if (usersNode) {
    const usersColCount = (usersNode.data as { columns?: unknown[] })?.columns?.length || 5;
    const usersHeight = getNodeHeight(usersColCount);
    positions[usersNode.id] = {
      x: centerX - NODE_WIDTH / 2,
      y: centerY - usersHeight / 2,
    };
  }
  
  // Helper: Group nodes into columns
  // Large tables (>= 8 fields) get their own column
  // Small tables can be stacked (max 2 per column)
  const createColumns = (tableNodes: Node[]): Node[][] => {
    const columns: Node[][] = [];
    let currentColumn: Node[] = [];
    
    tableNodes.forEach((node) => {
      const colCount = (node.data as { columns?: unknown[] })?.columns?.length || 3;
      const isLarge = colCount >= LARGE_TABLE_THRESHOLD;
      
      if (isLarge) {
        // Large table gets its own column
        if (currentColumn.length > 0) {
          columns.push(currentColumn);
          currentColumn = [];
        }
        columns.push([node]);
      } else {
        // Small table - stack up to 2 per column
        currentColumn.push(node);
        if (currentColumn.length >= 2) {
          columns.push(currentColumn);
          currentColumn = [];
        }
      }
    });
    
    if (currentColumn.length > 0) {
      columns.push(currentColumn);
    }
    
    return columns;
  };
  
  // Create columns for left and right sides
  const leftColumns = createColumns(leftNodes);
  const rightColumns = createColumns(rightNodes);
  
  // Position left side columns (going left from center)
  let currentX = centerX - NODE_WIDTH / 2 - HORIZONTAL_GAP - NODE_WIDTH;
  
  leftColumns.forEach((column) => {
    // Calculate total height of this column
    let totalHeight = 0;
    column.forEach((node) => {
      const colCount = (node.data as { columns?: unknown[] })?.columns?.length || 3;
      totalHeight += getNodeHeight(colCount);
    });
    totalHeight += (column.length - 1) * VERTICAL_GAP;
    
    // Start Y position to center the column vertically
    let currentY = centerY - totalHeight / 2;
    
    column.forEach((node) => {
      const colCount = (node.data as { columns?: unknown[] })?.columns?.length || 3;
      const height = getNodeHeight(colCount);
      
      positions[node.id] = {
        x: currentX,
        y: currentY,
      };
      
      currentY += height + VERTICAL_GAP;
    });
    
    currentX -= NODE_WIDTH + HORIZONTAL_GAP;
  });
  
  // Position right side columns (going right from center)
  currentX = centerX + NODE_WIDTH / 2 + HORIZONTAL_GAP;
  
  rightColumns.forEach((column) => {
    // Calculate total height of this column
    let totalHeight = 0;
    column.forEach((node) => {
      const colCount = (node.data as { columns?: unknown[] })?.columns?.length || 3;
      totalHeight += getNodeHeight(colCount);
    });
    totalHeight += (column.length - 1) * VERTICAL_GAP;
    
    // Start Y position to center the column vertically
    let currentY = centerY - totalHeight / 2;
    
    column.forEach((node) => {
      const colCount = (node.data as { columns?: unknown[] })?.columns?.length || 3;
      const height = getNodeHeight(colCount);
      
      positions[node.id] = {
        x: currentX,
        y: currentY,
      };
      
      currentY += height + VERTICAL_GAP;
    });
    
    currentX += NODE_WIDTH + HORIZONTAL_GAP;
  });
  
  // Apply positions to nodes
  const layoutedNodes = nodes.map(node => ({
    ...node,
    position: positions[node.id] || { x: centerX, y: centerY },
  }));
  
  return { nodes: layoutedNodes, edges };
};

interface SchemaVisualizationProps {
  data: SchemaVisualizationResponse;
  onRefresh: () => void;
  isLoading: boolean;
}

// Define your node types at module level, outside of components
const nodeTypesMap = {
  tableNode: TableNode,
};

// Define edge types with custom Manhattan routing
const edgeTypesMap = {
  manhattan: ManhattanEdge,
};

// Define default edge options - Manhattan routing with blue color
const defaultEdgeOptionsConfig = {
  type: 'manhattan',
  animated: false,
  style: { stroke: EDGE_COLOR, strokeWidth: 3 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: EDGE_COLOR,
    width: 16,
    height: 16,
  },
};

// React Flow component wrapped in provider
const SchemaVisualizationFlow: React.FC<SchemaVisualizationProps> = ({ data, onRefresh, isLoading }) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const reactFlowInstance = useReactFlow();

  // Initialize nodes and edges states with correct v12 types
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [savedLayout, setSavedLayout] = useState<Record<string, { x: number; y: number }> | null>(null);

  // Load saved layout from localStorage if available
  useEffect(() => {
    const layout = loadSchemaLayout();
    if (layout) {
      setSavedLayout(layout);
    }
  }, []);

  // Transform API data to React Flow nodes with positions using Dagre layout
  useEffect(() => {
    const dataNodes = data?.nodes ?? [];
    const dataEdges = data?.edges ?? [];
    
    if (dataNodes.length === 0) return;

    const filteredNodes = dataNodes.filter((node) => !isSystemTable(node.id));

    // Process foreign key relationships for highlighting
    const foreignKeyMap: Record<string, string[]> = {};
    dataEdges.forEach((edge) => {
      if (!foreignKeyMap[edge.source]) foreignKeyMap[edge.source] = [];
      foreignKeyMap[edge.source].push(edge.source_column);
    });

    // Create initial flow nodes
    const initialFlowNodes: Node[] = filteredNodes.map((node) => {
      const nodeColumns = node.columns ?? [];
      const nodePrimaryKeys = node.primary_keys ?? [];

      return {
        id: node.id,
        type: 'tableNode',
        position: { x: 0, y: 0 }, // Will be set by Dagre or saved layout
        data: {
          ...node,
          label: node.label,
          foreignKeys: foreignKeyMap[node.id] || [],
          columns: nodeColumns.map((col) => ({
            ...col,
            is_primary_key:
              col.column_default?.includes('gen_random_uuid()') ||
              col.column_name === 'id' ||
              nodePrimaryKeys.includes(col.column_name),
          })),
        },
        draggable: true,
      };
    });

    // Helper function to create edges with proper handle sides based on node positions
    const createEdgesWithHandles = (layoutedNodes: Node[]): Edge[] => {
      const nodePositions = new Map(layoutedNodes.map(n => [n.id, n.position]));
      const nodeIds = new Set(layoutedNodes.map((n) => n.id));
      
      return dataEdges
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map((edge, idx) => {
          const sourcePos = nodePositions.get(edge.source);
          const targetPos = nodePositions.get(edge.target);
          
          // Determine handle sides based on relative positions
          // If source is to the left of target, use R->L, otherwise L->R
          const sourceToRight = (sourcePos?.x ?? 0) < (targetPos?.x ?? 0);
          const sourceHandle = `${edge.source_column}_${sourceToRight ? 'R' : 'L'}`;
          const targetHandle = `${edge.target_column}_${sourceToRight ? 'L' : 'R'}`;
          
          return {
            id: edge.id || `${edge.source}.${edge.source_column}->${edge.target}.${edge.target_column}-${idx}`,
            source: edge.source,
            target: edge.target,
            sourceHandle,
            targetHandle,
            type: 'manhattan',
            animated: false,
            style: { stroke: EDGE_COLOR, strokeWidth: 3 },
            markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR },
            data: { index: idx }, // Pass index for corridor distribution
          };
        });
    };

    // Check if we have a saved layout
    if (savedLayout && Object.keys(savedLayout).length > 0) {
      // Use saved positions
      const flowNodesWithSavedPositions = initialFlowNodes.map((node) => {
        const savedPosition = savedLayout[node.id];
        if (savedPosition) {
          return { ...node, position: savedPosition };
        }
        // Fallback for new nodes not in saved layout - position at origin
        return node;
      });
      const edgesWithHandles = createEdgesWithHandles(flowNodesWithSavedPositions);
      setNodes(flowNodesWithSavedPositions);
      setEdges(edgesWithHandles);
    } else {
      // Use custom centered layout with Users at center
      const { nodes: layoutedNodes } = getCenteredLayout(
        initialFlowNodes,
        [] // Edges will be created after layout
      );
      const edgesWithHandles = createEdgesWithHandles(layoutedNodes);
      setNodes(layoutedNodes);
      setEdges(edgesWithHandles);
    }
  }, [data, savedLayout, setNodes, setEdges]);

  // Save node positions to localStorage
  const saveLayout = useCallback(() => {
    if (!nodes.length) return;

    const positions: Record<string, { x: number; y: number }> = {};
    nodes.forEach((node) => {
      positions[node.id] = { x: node.position.x, y: node.position.y };
    });

    saveSchemaLayout(positions);
    // Show a subtle toast message
    const toast = document.createElement('div');
    toast.className = 'fixed top-4 right-4 bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-300 px-4 py-2 rounded shadow z-50';
    toast.textContent = 'Layout saved successfully!';
    document.body.appendChild(toast);
    setTimeout(() => document.body.removeChild(toast), 3000);
  }, [nodes]);

  // Export diagram as PNG
  const exportAsPng = useCallback(() => {
    if (!reactFlowInstance) return;

    // Use reactflow's screenshot functionality
    // @ts-expect-error - toImage is available in reactflow but not in type definitions
    const dataUrl = reactFlowInstance.toImage();
    const link = document.createElement('a');
    link.download = 'schema-diagram.png';
    link.href = dataUrl;
    link.click();
  }, [reactFlowInstance]);

  // Handle React Flow errors
  const handleReactFlowError = (msgId: string, msg: string) => {
    // Suppress the nodeTypes warning (error code 002)
    if (msgId === '002') {
      return;
    }
    console.warn(msg);
  };

  if (!data || !data.nodes || !data.edges) {
    return (
      <div className="flex justify-center items-center h-full">
        <div className="text-gray-500 dark:text-slate-400 text-center">
          <p className="mb-2">No schema data available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypesMap}
        edgeTypes={edgeTypesMap}
        onError={handleReactFlowError}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        attributionPosition="bottom-right"
        defaultEdgeOptions={defaultEdgeOptionsConfig}
        connectionLineStyle={{ stroke: EDGE_COLOR, strokeWidth: 3 }}
        snapToGrid={true}
        snapGrid={[15, 15]}
        className="flex-grow bg-gray-50 dark:bg-slate-900"
      >
        <Controls className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded" />
        <MiniMap
          nodeStrokeWidth={3}
          zoomable
          pannable
          className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded"
        />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="rgb(209 213 219)" />
        <Panel position="top-right">
          <div className="flex gap-2 bg-white dark:bg-slate-800 p-2 rounded shadow border border-gray-200 dark:border-slate-700">
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={saveLayout}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
            >
              <Save className="h-4 w-4" />
              Save Layout
            </button>
            <button 
              onClick={exportAsPng}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
            >
              <Download className="h-4 w-4" />
              Export PNG
            </button>
          </div>
        </Panel>
      </ReactFlow>
      <p className="text-xs text-gray-500 dark:text-slate-400 text-center p-[5px] min-h-[20px]">
        Tip: Drag tables to organize your schema. Click on a table to view its details.
      </p>
    </div>
  );
};

// Wrap the component with ReactFlowProvider
const SchemaVisualization: React.FC<SchemaVisualizationProps> = ({ data, onRefresh, isLoading }) => {
  return (
    <div className="w-full h-full flex flex-col">
      <ReactFlowProvider>
        <SchemaVisualizationFlow data={data} onRefresh={onRefresh} isLoading={isLoading} />
      </ReactFlowProvider>
    </div>
  );
};

export default SchemaVisualization;
