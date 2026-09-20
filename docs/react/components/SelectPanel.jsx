import { StickyPanel } from './StickyPanel.jsx';
import { useId } from 'react';
import { Field, Select } from './UI.jsx';
/** A compact selector for a long list of named content panels. */
export function SelectPanel({ items, value, onChange, label, sticky = false }) {
  const id = useId();
  const active = items.find((item) => item.id === value) ?? items[0];
  if (!active) return null;
  return (
    <StickyPanel
      sticky={sticky}
      controls={
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
      }
    >
      <div id={id} className="grid min-w-0 gap-4">
        {active.render()}
      </div>
    </StickyPanel>
  );
}
