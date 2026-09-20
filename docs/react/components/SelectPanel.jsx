import { useId } from 'react';
import { Field, Select } from './UI.jsx';
/** A compact selector for a long list of named content panels. */
export function SelectPanel({ items, value, onChange, label }) {
  const id = useId();
  const active = items.find((item) => item.id === value) ?? items[0];
  if (!active) return null;
  return (
    <div className="grid min-w-0 gap-4">
      <Field label={label} className="w-full max-w-xl">
        <Select
          value={active.id}
          aria-controls={id}
          onChange={(event) => onChange(event.target.value)}
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>
      <div id={id} className="grid min-w-0 gap-4">
        {active.render()}
      </div>
    </div>
  );
}
