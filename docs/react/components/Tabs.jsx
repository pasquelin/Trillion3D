import { useId, useRef } from 'react';
/** Shared DaisyUI tabs with linked panels and standard arrow/Home/End keyboard navigation. */
export function Tabs({ items, value, onChange, label }) {
  const id = useId(),
    buttons = useRef([]);
  const active = items.find((item) => item.id === value) ?? items[0];
  function keyboard(event, index) {
    const direction = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    let next;
    if (direction) next = (index + direction + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next].id);
    buttons.current[next]?.focus();
  }
  if (!active) return null;
  return (
    <div className="grid min-w-0 gap-4">
      <div className="tabs tabs-box flex-wrap w-full" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            type="button"
            key={item.id}
            role="tab"
            id={`${id}-${item.id}`}
            aria-controls={`${id}-panel-${item.id}`}
            aria-selected={item.id === active.id}
            tabIndex={item.id === active.id ? 0 : -1}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            className={`tab ${item.id === active.id ? 'tab-active' : ''}`}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => keyboard(event, index)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-${active.id}`}
        aria-labelledby={`${id}-${active.id}`}
        className="grid min-w-0 gap-4"
        tabIndex={0}
      >
        {active.render()}
      </div>
    </div>
  );
}
