import { createContext, useContext, useId } from 'react';
import type {
  AlertProps,
  ButtonProps,
  CardProps,
  FieldProps,
  FormProps,
  RangeProps,
  SelectProps,
  ToggleProps,
} from '../types/components.ts';

const FieldLabel = createContext<string | undefined>(undefined);
const tones: Record<string, string> = {
  info: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  error: 'alert-error',
};
const buttons: Record<string, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
};
const sizes: Record<string, string> = { sm: 'btn-sm', md: 'btn-md', lg: 'btn-lg' };

export function Button({
  children,
  variant = 'ghost',
  size = 'md',
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn ${buttons[variant] ?? buttons.ghost} ${sizes[size] ?? sizes.md} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export const CARD_SURFACE = 'card bg-base-200 border border-base-300';

export const surfaceClass = (surface?: string): string =>
  ({ default: 'bg-base-200', nested: 'bg-base-100', inset: 'bg-base-300' })[surface ?? ''] ??
  'bg-base-200';

export function Card({
  children,
  title,
  className = '',
  surface = 'default',
  ...props
}: CardProps) {
  return (
    <section
      className={`card ${surfaceClass(surface)} border border-base-300 ${className}`}
      {...props}
    >
      <div className="card-body gap-4 p-4">
        {title && <h2 className="card-title text-lg">{title}</h2>}
        {children}
      </div>
    </section>
  );
}

export function Alert({ children, tone = 'info', className = '', ...props }: AlertProps) {
  return (
    <div className={`alert alert-soft ${tones[tone] ?? tones.info} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function Field({ label, children, className = '', ...props }: FieldProps) {
  const labelId = useId();
  return (
    <fieldset className={`fieldset min-w-0 ${className}`} {...props}>
      <legend id={labelId} className="fieldset-legend">
        {label}
      </legend>
      <FieldLabel.Provider value={labelId}>{children}</FieldLabel.Provider>
    </fieldset>
  );
}

export function Form({ children, className = '', ...props }: FormProps) {
  return (
    <fieldset className={`fieldset gap-4 ${className}`} {...props}>
      {children}
    </fieldset>
  );
}

export function Select({ children, size = 'md', className = '', ...props }: SelectProps) {
  const labelId = useContext(FieldLabel);
  return (
    <select
      aria-labelledby={props['aria-label'] ? undefined : labelId}
      className={`select w-full ${size === 'sm' ? 'select-sm' : 'select-md'} ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Range({ className = '', ...props }: RangeProps) {
  const labelId = useContext(FieldLabel);
  return (
    <input
      aria-labelledby={props['aria-label'] ? undefined : labelId}
      type="range"
      className={`range range-primary range-sm w-full ${className}`}
      {...props}
    />
  );
}

export function Toggle({ className = '', ...props }: ToggleProps) {
  const labelId = useContext(FieldLabel);
  return (
    <input
      aria-labelledby={props['aria-label'] ? undefined : labelId}
      type="checkbox"
      className={`toggle toggle-primary toggle-sm ${className}`}
      {...props}
    />
  );
}
