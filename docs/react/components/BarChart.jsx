import { Card } from './UI.jsx';
import { StatusBadge } from './StatusBadge.jsx';
const TONES = {
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
export function BarChart({ title, note, rows, format, missingLabel }) {
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  return (
    <Card surface="nested" title={title} className="min-w-0" data-chart>
      {note && <p className="text-sm text-base-content/75">{note}</p>}
      <ul className="grid gap-3 m-0 p-0 list-none">
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
                className={`progress h-3 w-full ${row.value === null ? 'progress-neutral bg-base-content/20' : (TONES[row.tone] ?? TONES.neutral)}`}
                value={row.value ?? 0}
                aria-disabled={row.value === null || undefined}
                aria-valuetext={row.value === null ? missingLabel : undefined}
                max={max || 1}
                aria-label={`${row.label} · ${title}`}
              />
            }
            {row.value !== null && row.status && (
              <StatusBadge tone={row.tone}>{row.status}</StatusBadge>
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
