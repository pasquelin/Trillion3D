import type { ReactNode } from 'react';
import type { ChartTone } from './BarChart.tsx';

const TONES: Record<ChartTone, string> = {
  primary: 'badge-primary',
  secondary: 'badge-secondary',
  accent: 'badge-accent',
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  neutral: 'badge-neutral',
};

interface StatusBadgeProps {
  tone?: ChartTone;
  children: ReactNode;
}

export function StatusBadge({ tone = 'neutral', children }: StatusBadgeProps) {
  return <span className={`badge badge-sm ${TONES[tone]}`}>{children}</span>;
}
