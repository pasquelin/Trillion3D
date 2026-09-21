import { useId, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { TabsProps } from '../types/components.ts';
import { StickyPanel } from './StickyPanel.tsx';

/** Shared DaisyUI tabs with linked panels and standard arrow/Home/End keyboard navigation. */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  label,
  sticky = false,
  accessory,
}: TabsProps<T>) {
  const id = useId(),
    buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const active = items.find((item) => item.id === value) ?? items[0];
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keyMap: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    const direction = keyMap[event.key];
    let next: number;
    if (direction !== undefined) next = (index + direction + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next].id);
    buttons.current[next]?.focus();
  }
  if (!active) return null;
  return (
    <StickyPanel
      sticky={sticky}
      controls={
        <div className="flex min-w-0 items-center gap-4 overflow-x-auto">
          <div className="tabs tabs-box flex-nowrap flex-1" role="tablist" aria-label={label}>
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
                className={`tab shrink-0 whitespace-nowrap ${item.id === active.id ? 'tab-active' : ''}`}
                onClick={() => onChange(item.id)}
                onKeyDown={(event) => keyboard(event, index)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {accessory && <div className="shrink-0">{accessory}</div>}
        </div>
      }
    >
      <div
        role="tabpanel"
        id={`${id}-panel-${active.id}`}
        aria-labelledby={`${id}-${active.id}`}
        className="grid min-w-0 gap-4"
        tabIndex={0}
      >
        {active.render()}
      </div>
    </StickyPanel>
  );
}
