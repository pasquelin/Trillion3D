import { useEffect, useRef } from 'react';
import { QUIET_FOCUS } from './Input.tsx';

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
    <label className={`input input-sm w-full min-w-0 px-2 ${QUIET_FOCUS}`}>
      <span className="label">{label}</span>
      <input
        ref={input}
        type="color"
        className={`min-w-0 ${QUIET_FOCUS}`}
        defaultValue={value}
        onInput={(event) => onLive(event.currentTarget.value)}
      />
    </label>
  );
}
