import type { KeyboardEvent } from 'react';
import { QUIET_FOCUS } from './Input.tsx';

/** The three axes' colours, x red, y green, z blue: the theme's `axis-*` tokens. */
const AXIS_COLOURS = { x: 'bg-axis-x', y: 'bg-axis-y', z: 'bg-axis-z' } as const;
type Axis = keyof typeof AXIS_COLOURS;

/** The box a field sits in, its label before its value: small, tight, never outlined. */
const BOX = `input input-sm w-full min-w-0 gap-1 px-1.5 ${QUIET_FOCUS}`;
/** The value itself: it takes what the label leaves, its digits aligned, no spin buttons. */
const VALUE = `min-w-0 flex-1 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${QUIET_FOCUS}`;

/** What a number field shows at rest: three decimals at most, so a float's tail never fills the
 *  box; the field shows the whole number while it is edited. */
const shown = (value: number) => Number(value.toFixed(3));

/** Commits a field on Enter; Escape puts back `shownValue`, the value the edit started from. */
function keys(event: KeyboardEvent<HTMLInputElement>, shownValue: string) {
  if (event.key === 'Enter') event.currentTarget.blur();
  if (event.key === 'Escape') {
    event.currentTarget.value = shownValue;
    event.currentTarget.blur();
  }
}

/** The name before a field's value: an axis as its coloured letter, any other word cut with an
 *  ellipsis when the box is narrow, whole in its tooltip. */
function Label({ label, axis }: { label: string; axis?: Axis }) {
  if (axis)
    return (
      <span
        className={`grid size-4 shrink-0 place-items-center rounded-sm text-[11px] font-bold text-white ${AXIS_COLOURS[axis]}`}
      >
        {label}
      </span>
    );
  return (
    <span className="label min-w-0 shrink truncate" title={label}>
      {label}
    </span>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  /** Marks the field as one axis of a vector: its label becomes the axis's coloured letter. */
  axis?: Axis;
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
export function NumberField({
  label,
  value,
  axis,
  step = 0.1,
  min,
  max,
  onCommit,
}: NumberFieldProps) {
  const text = String(shown(value));
  return (
    <label className={BOX}>
      <Label label={label} axis={axis} />
      <input
        key={text}
        type="number"
        className={VALUE}
        defaultValue={text}
        step={step}
        min={min}
        max={max}
        onFocus={(event) => {
          event.currentTarget.value = String(value);
        }}
        // Escape puts back the whole number the field showed while edited: no edit then.
        onKeyDown={(event) => keys(event, String(value))}
        onBlur={(event) => {
          const typed = event.currentTarget.value,
            next = Number(typed);
          // The field shows the object's value: the new one once the edit lands, which may be
          // another than typed (a count below a shape's fewest), or the old one again.
          event.currentTarget.value = text;
          if (typed !== '' && Number.isFinite(next) && next !== value) onCommit(next);
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
    <label className={BOX}>
      <Label label={label} />
      <input
        key={value}
        type="text"
        className={VALUE}
        defaultValue={value}
        onKeyDown={(event) => keys(event, value)}
        onBlur={(event) => {
          if (event.currentTarget.value !== value) onCommit(event.currentTarget.value);
        }}
      />
    </label>
  );
}
