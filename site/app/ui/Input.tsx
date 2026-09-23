import { createContext, useContext, useId } from 'react';
import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  KeyboardEvent,
  ReactNode,
} from 'react';
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

export function Toggle({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      aria-labelledby={labelledBy(props, useContext(FieldLabel))}
      type="checkbox"
      className={`toggle toggle-primary toggle-sm ${QUIET_FOCUS} ${className}`}
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

/** What a number field shows: three decimals at most, so a float's tail never fills the box. */
const shown = (value: number) => Number(value.toFixed(3));

/** Commits a field on Enter; Escape puts back what it showed. */
function keys(event: KeyboardEvent<HTMLInputElement>, shownValue: string) {
  if (event.key === 'Enter') event.currentTarget.blur();
  if (event.key === 'Escape') {
    event.currentTarget.value = shownValue;
    event.currentTarget.blur();
  }
}

interface NumberFieldProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}

/**
 * A number the person types, committed once — on Enter or when the field is left — so that one
 * edit is one command. It shows the object's value again whenever that changes elsewhere (a drag
 * of the handles, an undo): the field is keyed by it.
 */
export function NumberField({ label, value, step = 0.1, min, max, onCommit }: NumberFieldProps) {
  const text = String(shown(value));
  return (
    <label className="input input-sm w-full min-w-0">
      <span className="label">{label}</span>
      <input
        key={text}
        type="number"
        className="min-w-0"
        defaultValue={text}
        step={step}
        min={min}
        max={max}
        onKeyDown={(event) => keys(event, text)}
        onBlur={(event) => {
          const typed = event.currentTarget.value,
            next = Number(typed);
          // The field shows the object's value: the new one once the edit lands, which may be
          // another than typed (a count below a shape's fewest), or the old one again.
          event.currentTarget.value = text;
          if (typed !== '' && Number.isFinite(next) && next !== shown(value)) onCommit(next);
        }}
      />
    </label>
  );
}

/** A line of text committed once, on Enter or when the field is left, like `NumberField`. */
export function TextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  return (
    <label className="input input-sm w-full min-w-0">
      <span className="label">{label}</span>
      <input
        key={value}
        type="text"
        className="min-w-0"
        defaultValue={value}
        onKeyDown={(event) => keys(event, value)}
        onBlur={(event) => {
          if (event.currentTarget.value !== value) onCommit(event.currentTarget.value);
        }}
      />
    </label>
  );
}
