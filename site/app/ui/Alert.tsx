import type { ComponentPropsWithoutRef } from 'react';

interface AlertProps extends ComponentPropsWithoutRef<'div'> {
  tone?: 'info' | 'success' | 'warning' | 'error';
}

const tones: Record<NonNullable<AlertProps['tone']>, string> = {
  info: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  error: 'alert-error',
};

/** The DaisyUI soft alert: a status or a warning set apart from the text. */
export function Alert({ children, tone = 'info', className = '', ...props }: AlertProps) {
  return (
    <div className={`alert alert-soft ${tones[tone]} ${className}`} {...props}>
      {children}
    </div>
  );
}
