import { createContext, useContext, useId } from 'react';
import type { ComponentPropsWithoutRef, ComponentPropsWithRef, ReactNode } from 'react';
import { Icon } from './Icon.tsx';

interface FieldProps extends ComponentPropsWithoutRef<'fieldset'> {
  label: ReactNode;
}

interface SelectProps extends Omit<ComponentPropsWithoutRef<'select'>, 'size'> {
  size?: 'sm' | 'md';
}

/** Inputs show focus by their border alone, never by an outline or a ring. */
const QUIET_FOCUS = 'focus:outline-none focus-within:outline-none focus-visible:outline-none';

/** The legend of the field an input sits in, which names the input when it has no label. */
const FieldLabel = createContext<string | undefined>(undefined);

const labelledBy = (props: { 'aria-label'?: string }, labelId: string | undefined) =>
  props['aria-label'] ? undefined : labelId;

/** A DaisyUI fieldset with its legend, naming the inputs inside it. */
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

/** A group of fields, spaced as one form. */
export function Form({ children, className = '', ...props }: ComponentPropsWithoutRef<'fieldset'>) {
  return (
    <fieldset className={`fieldset gap-4 ${className}`} {...props}>
      {children}
    </fieldset>
  );
}

export function Select({ children, size = 'md', className = '', ...props }: SelectProps) {
  return (
    <select
      aria-labelledby={labelledBy(props, useContext(FieldLabel))}
      className={`select w-full ${size === 'sm' ? 'select-sm' : 'select-md'} ${QUIET_FOCUS} ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Range({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      aria-labelledby={labelledBy(props, useContext(FieldLabel))}
      type="range"
      className={`range range-primary range-sm w-full ${QUIET_FOCUS} ${className}`}
      {...props}
    />
  );
}

/** A DaisyUI search field: the magnifier inside the `input` label, then the field, then an
 * optional key hint. */
export function SearchInput({
  hint,
  size = 'md',
  ...props
}: Omit<ComponentPropsWithRef<'input'>, 'type' | 'size' | 'className'> & {
  hint?: ReactNode;
  size?: 'md' | 'lg';
}) {
  return (
    <label className={`input w-full ${size === 'lg' ? 'input-lg' : 'input-md'} ${QUIET_FOCUS}`}>
      <Icon name="search" />
      <input type="search" className={`grow ${QUIET_FOCUS}`} autoComplete="off" {...props} />
      {hint && <kbd className="kbd kbd-sm">{hint}</kbd>}
    </label>
  );
}
