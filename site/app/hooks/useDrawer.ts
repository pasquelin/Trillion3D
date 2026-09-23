import { useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'a, input, button, summary';

/**
 * The narrow screen's sidebar drawer: whether it is open, and the element it lives in. While
 * open, Tab stays inside it and Escape closes it; a new route closes it, and focus returns where
 * it was.
 */
export function useDrawer() {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const close = () => setOpen(false);
    addEventListener('hashchange', close);
    return () => removeEventListener('hashchange', close);
  }, []);
  useEffect(() => {
    if (!open) return;
    const returnFocus = document.activeElement as HTMLElement | null;
    const items = () =>
      [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (element) => element.getClientRects().length > 0,
      );
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const all = items();
      const edge = event.shiftKey ? all[0] : all.at(-1);
      if (document.activeElement !== edge) return;
      event.preventDefault();
      (event.shiftKey ? all.at(-1) : all[0])?.focus();
    };
    addEventListener('keydown', keydown);
    items()[0]?.focus();
    return () => {
      removeEventListener('keydown', keydown);
      returnFocus?.focus();
    };
  }, [open]);
  return {
    open,
    panel,
    toggle: () => setOpen((value) => !value),
    close: () => setOpen(false),
  };
}
