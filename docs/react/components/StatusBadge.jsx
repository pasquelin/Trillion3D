const TONES = {
  primary: 'badge-primary',
  secondary: 'badge-secondary',
  accent: 'badge-accent',
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  neutral: 'badge-neutral',
};
export function StatusBadge({ tone = 'neutral', children }) {
  return <span className={`badge badge-sm ${TONES[tone] ?? TONES.neutral}`}>{children}</span>;
}
