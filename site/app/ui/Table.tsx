import type { ReactNode } from 'react';

interface TableProps {
  children: ReactNode;
  label?: string;
  wide?: boolean;
  className?: string;
}

/** Shared, horizontally scrollable DaisyUI table; striping is consistent across the site. */
export function Table({ children, label, wide = false, className = '' }: TableProps) {
  return (
    <div
      className="min-w-0 max-w-full overflow-x-auto"
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
    >
      <table
        className={`table table-zebra w-full tabular-nums [&_small]:block [&_small]:text-base-content/70 ${wide ? '[&_th]:min-w-56 [&_td]:min-w-56 [&_td]:max-w-96 [&_td]:break-words [&_th]:whitespace-normal' : ''} ${className}`}
      >
        {children}
      </table>
    </div>
  );
}

/** A table of named fields — a parameter, a member, a value — under its column heads: the name
 * in code on one line, then what the other columns say of it. */
export function FieldTable({
  head,
  rows,
}: {
  head: string[];
  rows: { key: string; cells: ReactNode[] }[];
}) {
  return (
    <Table>
      <thead>
        <tr>
          {head.map((title) => (
            <th key={title}>{title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {row.cells.map((cell, index) => (
              <td
                key={index}
                className={
                  index === 0 ? 'align-top font-mono font-semibold whitespace-nowrap' : 'align-top'
                }
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
