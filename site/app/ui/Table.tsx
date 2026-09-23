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

/** A two-column table of names, in code, and what each one means. */
export function DefinitionTable({ rows }: { rows: { name: string; value: ReactNode }[] }) {
  return (
    <Table>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td className="align-top font-mono font-semibold">{row.name}</td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
