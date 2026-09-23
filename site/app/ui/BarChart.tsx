import type { ReactNode } from 'react';
import { Card } from './Card.tsx';
import { Badge } from './Badge.tsx';
import type { BadgeTone } from './Badge.tsx';

export interface BarChartRow {
  id?: string | number;
  label: ReactNode;
  value: number | null;
  missing?: string;
  tone?: BadgeTone;
  status?: ReactNode;
  p95?: number | null;
}

interface BarChartProps {
  title: ReactNode;
  note?: ReactNode;
  rows: BarChartRow[];
  format: (value: number) => string;
  missingLabel?: string;
}

const TONES: Record<BadgeTone, string> = {
  primary: 'progress-primary',
  secondary: 'progress-secondary',
  accent: 'progress-accent',
  info: 'progress-info',
  success: 'progress-success',
  warning: 'progress-warning',
  error: 'progress-error',
  neutral: 'progress-neutral',
};

/** A shared card and DaisyUI progress bars, with one zero-based scale per metric. */
export function BarChart({ title, note, rows, format, missingLabel }: BarChartProps) {
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  return (
    <Card surface="nested" title={title} className="min-w-0" data-chart>
      {note && <p className="text-sm text-base-content/75">{note}</p>}
      <ul className="grid grid-cols-1 gap-3 m-0 p-0 list-none">
        {rows.map((row, i) => (
          <li key={row.id ?? i}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>{row.label}</span>
              <strong className="tabular-nums">
                {row.value === null ? (row.missing ?? missingLabel) : format(row.value)}
              </strong>
            </div>
            {
              <progress
                className={`progress h-3 w-full ${row.value === null ? 'progress-neutral bg-base-content/20' : TONES[row.tone ?? 'neutral']}`}
                value={row.value ?? 0}
                aria-disabled={row.value === null || undefined}
                aria-valuetext={row.value === null ? missingLabel : undefined}
                max={max || 1}
                aria-label={`${row.label} · ${title}`}
              />
            }
            {row.value !== null && row.status && (
              <Badge size="sm" tone={row.tone}>
                {row.status}
              </Badge>
            )}
            {row.p95 != null && (
              <small className="block text-base-content/70">p95 · {format(row.p95)}</small>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
