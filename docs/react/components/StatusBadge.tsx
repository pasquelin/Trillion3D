import type { ReactNode } from 'react';
import type { ChartTone } from '../types/components.ts';

const TONES: Record<string, string> = {
  primary: 'badge-primary',
  secondary: 'badge-secondary',
  accent: 'badge-accent',
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  neutral: 'badge-neutral',
};

type StatusBadgeTone = ChartTone;

export interface StatusBadgeProps {
  tone?: StatusBadgeTone | string;
  children: ReactNode;
}

export function StatusBadge({ tone = 'neutral', children }: StatusBadgeProps) {
  return <span className={`badge badge-sm ${TONES[tone] ?? TONES.neutral}`}>{children}</span>;
}
