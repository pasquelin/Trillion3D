import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

interface DropdownItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Marks the item as the chosen one, for a menu that picks a value. */
  pressed?: boolean;
  className?: string;
}

interface DropdownProps {
  /** What the button that opens the menu shows. */
  label: ReactNode;
  items: DropdownItem[];
  'aria-label'?: string;
  /** The opening button's classes: a small ghost button unless told otherwise. */
  triggerClassName?: string;
  /** The list's width classes. */
  menuClassName?: string;
  /** Opens the list aligned on the button's right edge. */
  end?: boolean;
}

/** Moves the focus to the next (`step` 1) or previous (`step` -1) enabled item, wrapping. */
function moveFocus(list: HTMLElement, step: 1 | -1) {
  const buttons = [...list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if (buttons.length === 0) return;
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = at < 0 ? (step > 0 ? 0 : buttons.length - 1) : at + step;
  buttons[(next + buttons.length) % buttons.length].focus();
}

/**
 * A DaisyUI dropdown: a button, then its list of items once opened. It closes when an item is
 * chosen, on a click outside it, and on Escape, which gives the focus back to the button; the
 * arrow keys move between the enabled items.
 */
export function Dropdown({
  label,
  items,
  'aria-label': ariaLabel,
  triggerClassName = 'btn btn-ghost btn-sm',
  menuClassName = 'w-56',
  end = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // Captured: a canvas or a control that stops the event still closes the menu.
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      root.current?.querySelector('summary')?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (open) moveFocus(list.current!, event.key === 'ArrowDown' ? 1 : -1);
      else setOpen(true);
    }
  };
  return (
    <details
      ref={root}
      className={`dropdown ${end ? 'dropdown-end' : ''}`}
      open={open}
      onKeyDown={onKeyDown}
    >
      {/* The state alone opens and closes the list: the summary's own toggle is cancelled. */}
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen(!open);
        }}
        className={`list-none [&::-webkit-details-marker]:hidden ${triggerClassName}`}
        aria-label={ariaLabel}
      >
        {label}
      </summary>
      <ul
        ref={list}
        className={`menu dropdown-content z-20 mt-1 max-w-[80vw] rounded-box border border-base-300 bg-base-200 shadow-lg ${menuClassName}`}
      >
        {items.map((item) => (
          <li
            key={item.key}
            className={`${item.disabled ? 'menu-disabled' : ''} ${item.className ?? ''}`}
          >
            <button
              type="button"
              disabled={item.disabled}
              aria-pressed={item.pressed}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
