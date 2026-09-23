import type { ComponentPropsWithoutRef } from 'react';

export type BadgeTone =
  'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error' | 'neutral';

const tones: Record<BadgeTone, string> = {
  primary: 'badge-primary',
  secondary: 'badge-secondary',
  accent: 'badge-accent',
  info: 'badge-info',
  success: 'badge-success',
  warning: 'badge-warning',
  error: 'badge-error',
  neutral: 'badge-neutral',
};

interface Look {
  tone?: BadgeTone;
  soft?: boolean;
  size?: 'sm' | 'md';
  mono?: boolean;
}

const look = ({ tone = 'neutral', soft = false, size = 'md', mono = false }: Look) =>
  `badge ${tones[tone]} ${soft ? 'badge-soft' : ''} ${size === 'sm' ? 'badge-sm' : ''} ${mono ? 'font-mono' : ''}`;

/** The DaisyUI badge: a short label beside a title or a value. */
export function Badge({
  tone,
  soft,
  size,
  mono,
  className = '',
  ...props
}: ComponentPropsWithoutRef<'span'> & Look) {
  return <span className={`${look({ tone, soft, size, mono })} ${className}`} {...props} />;
}
