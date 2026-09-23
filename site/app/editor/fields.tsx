import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';

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
          const next = Number(event.currentTarget.value);
          if (event.currentTarget.value !== '' && Number.isFinite(next) && next !== shown(value))
            onCommit(next);
          else event.currentTarget.value = text;
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

interface ColorFieldProps {
  label: string;
  /** `#rrggbb`. */
  value: string;
  /** Every move of the picker: repaints at once, the material's cheap path. */
  onLive: (value: string) => void;
  /** The picker closed: one command, from the colour it opened on to the one it closed on. */
  onCommit: (before: string, after: string) => void;
}

/** A colour picker that repaints live as it moves and records one edit when it closes. */
export function ColorField({ label, value, onLive, onCommit }: ColorFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const opened = useRef(value);
  const latest = useRef({ onCommit });
  latest.current.onCommit = onCommit;
  // The native `change` event marks the picker closing; React's `onChange` fires on every move.
  useEffect(() => {
    const field = input.current!;
    const closed = () => {
      if (field.value !== opened.current) latest.current.onCommit(opened.current, field.value);
      opened.current = field.value;
    };
    field.addEventListener('change', closed);
    return () => field.removeEventListener('change', closed);
  }, []);
  useEffect(() => {
    opened.current = value;
    if (input.current && input.current.value !== value) input.current.value = value;
  }, [value]);
  return (
    <label className="input input-sm w-full min-w-0">
      <span className="label">{label}</span>
      <input
        ref={input}
        type="color"
        className="min-w-0"
        defaultValue={value}
        onInput={(event) => onLive(event.currentTarget.value)}
      />
    </label>
  );
}
