import React from 'react';
import { Handle, Position } from "@xyflow/react";
import { useNavigate } from 'react-router-dom';
import type { SchemaNode } from '../../client/types.gen';

interface TableNodeProps {
  data: SchemaNode & { foreignKeys?: string[] };
}

const TableNode: React.FC<TableNodeProps> = ({ data }) => {
  const navigate = useNavigate();

  const handleTableClick = () => {
    navigate(`/tables/${data.id}`);
  };

  // Determine which columns are foreign keys
  const foreignKeyColumns = data.foreignKeys || [];

  return (
    <div
      className="border-2 border-blue-600 rounded bg-white dark:bg-slate-800 w-[220px] shadow-md cursor-pointer hover:shadow-lg transition-shadow"
      onClick={handleTableClick}
    >
      {/* Table header */}
      <div className="bg-blue-600 text-white p-2 font-bold text-center rounded-t text-sm">
        {data.label}
      </div>

      {/* Table columns */}
      <div className="p-2">
        {(data.columns ?? []).map((column) => {
          const isPrimaryKey = column.is_primary_key;
          const isForeignKey = foreignKeyColumns.includes(column.column_name);

          return (
            <div
              key={column.column_name}
              className="flex justify-between py-1 border-b border-gray-100 dark:border-slate-700 last:border-b-0 relative"
            >
              <div className={`
                ${isPrimaryKey ? 'text-blue-600 dark:text-blue-400 font-medium' : ''}
                ${isForeignKey ? 'text-teal-500 dark:text-teal-400 font-medium' : 'text-gray-800 dark:text-slate-300'}
                text-xs
              `}>
                {isPrimaryKey && '🔑 '}
                {isForeignKey && '🔗 '}
                {column.column_name}
              </div>
              <div className="text-gray-600 dark:text-slate-400 text-xs">
                {column.data_type}
              </div>

              {/* Add connection points (both sides) for foreign keys and primary keys */}
              {(isPrimaryKey || isForeignKey) && (
                <>
                  <Handle
                    type={isForeignKey ? "source" : "target"}
                    position={Position.Left}
                    id={`${column.column_name}_L`}
                    style={{
                      background: isForeignKey ? 'rgb(20, 184, 166)' : 'rgb(37, 99, 235)',
                      width: 8,
                      height: 8,
                    }}
                    isConnectable
                  />
                  <Handle
                    type={isForeignKey ? "source" : "target"}
                    position={Position.Right}
                    id={`${column.column_name}_R`}
                    style={{
                      background: isForeignKey ? 'rgb(20, 184, 166)' : 'rgb(37, 99, 235)',
                      width: 8,
                      height: 8,
                    }}
                    isConnectable
                  />
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TableNode;
