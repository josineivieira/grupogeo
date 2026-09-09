'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type VisibilityState,
} from '@tanstack/react-table';
import { ArrowDownUp, ChevronLeft, ChevronRight, Columns3, FileSearch } from 'lucide-react';
import { display, Row, statusLabel } from '@/lib/api';
import { Button } from './ui';
export function DataTable({
  rows,
  columns,
  actions,
  page = 1,
  total = rows.length,
  limit = 20,
  onPage,
  onLimit,
  onSort,
  preferenceKey,
  onVisibleColumns,
  bulkActions,
}: {
  rows: Row[];
  columns: { key: string; label: string }[];
  actions?: (row: Row) => React.ReactNode;
  page?: number;
  total?: number;
  limit?: number;
  onPage?: (n: number) => void;
  onLimit?: (n: number) => void;
  onSort?: (key: string, direction: 'asc' | 'desc') => void;
  preferenceKey?: string;
  onVisibleColumns?: (keys: string[]) => void;
  bulkActions?: (rows: Row[]) => React.ReactNode;
}) {
  const [visibility, setVisibility] = useState<VisibilityState>({}),
    [select, setSelect] = useState({}),
    [show, setShow] = useState(false);
  useEffect(() => {
    if (!preferenceKey) return;
    try { setVisibility(JSON.parse(localStorage.getItem(`geo-columns:${preferenceKey}`) ?? '{}')); } catch { setVisibility({}); }
  }, [preferenceKey]);
  useEffect(() => {
    onVisibleColumns?.(columns.filter(c => visibility[c.key] !== false).map(c => c.key));
  }, [visibility, columns.map(c => c.key).join(',')]);
  const defs = useMemo<ColumnDef<Row>[]>(
    () => [
      ...(bulkActions ? [{
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Selecionar página"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label="Selecionar registro"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      } satisfies ColumnDef<Row>] : []),
      ...columns.map((c) => ({
        accessorKey: c.key,
        header: c.label,
        cell: ({ getValue }: { getValue: () => unknown }) => {
          const value = getValue();
          if (c.key === 'status')
            return (
              <span className={`badge badge-${String(value).toLowerCase()}`}>
                {statusLabel[String(value)] ?? display(value)}
              </span>
            );
          if (['salary', 'value', 'total'].includes(c.key) && value != null)
            return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
          return display(value);
        },
      })),
      ...(actions
        ? [
            {
              id: 'actions',
              header: 'Ações',
              cell: ({ row }: { row: { original: Row } }) => actions(row.original),
            },
          ]
        : []),
    ],
    [columns, actions, bulkActions],
  );
  const table = useReactTable({
    data: rows,
    columns: defs,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: { columnVisibility: visibility, rowSelection: select },
    onColumnVisibilityChange: (updater) => setVisibility(previous => {
      const next = typeof updater === 'function' ? updater(previous) : updater;
      if (preferenceKey) localStorage.setItem(`geo-columns:${preferenceKey}`, JSON.stringify(next));
      return next;
    }),
    onRowSelectionChange: setSelect,
    getRowId: (r) => r.id,
  });
  return (
    <div className="table-panel">
      <div className="table-caption">
        <span>
          <strong>{total.toLocaleString('pt-BR')}</strong> registros{' '}
          {Object.keys(select).length > 0 && ` · ${Object.keys(select).length} selecionados`}
        </span>
        {bulkActions && bulkActions(table.getSelectedRowModel().rows.map(r => r.original))}
        <div className="column-picker">
          <Button variant="ghost" onClick={() => setShow(!show)}>
            <Columns3 size={15} /> Colunas
          </Button>
          {show && (
            <div className="popover">
              {table
                .getAllLeafColumns()
                .filter((c) => !['select', 'actions'].includes(c.id))
                .map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={c.getIsVisible()}
                      onChange={c.getToggleVisibilityHandler()}
                    />
                    {columns.find((x) => x.key === c.id)?.label}
                  </label>
                ))}
            </div>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                {g.headers.map((h) => (
                  <th key={h.id}>
                    {h.isPlaceholder ? null : (
                      <div
                        className="th-content"
                        onClick={() => {
                          if (h.column.getCanSort()) {
                            h.column.toggleSorting();
                            onSort?.(
                              h.column.id,
                              h.column.getIsSorted() === 'asc' ? 'desc' : 'asc',
                            );
                          }
                        }}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getCanSort() && <ArrowDownUp size={12} />}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id}>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">
            <FileSearch size={30} />
            <strong>Nenhum registro encontrado</strong>
            <span>Revise os filtros ou cadastre o primeiro registro deste módulo.</span>
          </div>
        )}
      </div>
      <div className="pagination">
        <span>
          {total
            ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} de ${total}`
            : '0 registros'}
        </span>
        <div>
          {onLimit && (
            <select
              aria-label="Registros por página"
              value={limit}
              onChange={(e) => onLimit(Number(e.target.value))}
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n} por página
                </option>
              ))}
            </select>
          )}
          <span>
            Página {page} de {Math.max(1, Math.ceil(total / limit))}
          </span>
          <Button
            variant="outline"
            aria-label="Página anterior"
            disabled={page <= 1 || !onPage}
            onClick={() => onPage?.(page - 1)}
          >
            <ChevronLeft size={15} />
          </Button>
          <Button
            variant="outline"
            aria-label="Próxima página"
            disabled={page * limit >= total || !onPage}
            onClick={() => onPage?.(page + 1)}
          >
            <ChevronRight size={15} />
          </Button>
        </div>
      </div>
    </div>
  );
}
