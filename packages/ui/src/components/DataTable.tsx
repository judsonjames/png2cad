import type { ReactNode } from "react";

/**
 * A highlighted row. The highlight only draws the eye: the row's own text
 * must still say why ("Warning", "Fault", "Selected").
 */
export type RowTone = "warn" | "danger" | "selected";

export interface Column<Row> {
  key: string;
  label: ReactNode;
  /** The cell for a row; defaults to `row[key]`. */
  cell?: (row: Row) => ReactNode;
  align?: "start" | "end";
}

/**
 * A plain table with a caption for screen readers. It scrolls sideways inside
 * itself on narrow screens instead of widening the page.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty = "Nothing to show.",
  rowTone,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  caption: string;
  empty?: ReactNode;
  /** Highlights a row (warn, danger, selected), or none for `undefined`. */
  rowTone?: (row: Row) => RowTone | undefined;
}) {
  if (!rows.length) return <p className="p2c-help">{empty}</p>;
  return (
    <div className="p2c-table-scroll">
      <table className="p2c-table">
        <caption className="p2c-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.align === "end" ? "p2c-end" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const tone = rowTone?.(row);
            return (
              <tr key={rowKey(row, index)} className={tone ? `p2c-row-${tone}` : undefined}>
                {columns.map((column) => (
                  <td key={column.key} className={column.align === "end" ? "p2c-end" : undefined}>
                    {column.cell ? column.cell(row) : String((row as Record<string, unknown>)[column.key] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
