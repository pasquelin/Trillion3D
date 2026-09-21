import { createContext, useContext, useId } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export interface CardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
  title?: ReactNode;
  surface?: 'default' | 'nested' | 'inset';
}

interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
}

interface AlertProps extends ComponentPropsWithoutRef<'div'> {
  tone?: 'info' | 'success' | 'warning' | 'error';
}

interface FieldProps extends ComponentPropsWithoutRef<'fieldset'> {
  label: ReactNode;
}

interface SelectProps extends Omit<ComponentPropsWithoutRef<'select'>, 'size'> {
  size?: 'sm' | 'md';
}

const FieldLabel = createContext<string | undefined>(undefined);
const tones: Record<NonNullable<AlertProps['tone']>, string> = {
  info: 'alert-info',
  success: 'alert-success',
  warning: 'alert-warning',
  error: 'alert-error',
};
const buttons: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
};
const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'btn-sm',
  md: 'btn-md',
  lg: 'btn-lg',
};

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
      className={`btn ${buttons[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export const CARD_SURFACE = 'card bg-base-200 border border-base-300';

const surfaces: Record<NonNullable<CardProps['surface']>, string> = {
  default: 'bg-base-200',
  nested: 'bg-base-100',
  inset: 'bg-base-300',
};

export const surfaceClass = (surface: CardProps['surface'] = 'default'): string =>
  surfaces[surface];

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
    <div className={`alert alert-soft ${tones[tone]} ${className}`} {...props}>
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

export function Form({ children, className = '', ...props }: ComponentPropsWithoutRef<'fieldset'>) {
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

export function Range({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
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

export function Toggle({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
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
