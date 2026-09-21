import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export interface CardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: ReactNode;
  surface?: 'default' | 'nested' | 'inset';
}

export type ChartTone =
  'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

export interface BarChartRow {
  id?: string | number;
  label: ReactNode;
  value: number | null;
  missing?: string;
  tone?: ChartTone;
  status?: ReactNode;
  p95?: number | null;
}

export interface ProgressiveRange {
  start: number;
  end: number;
}

export interface ProgressiveListState extends ProgressiveRange {
  heights?: Record<string | number, number>;
}
