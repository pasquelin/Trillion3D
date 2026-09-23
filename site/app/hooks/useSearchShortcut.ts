import { useEffect } from 'react';

const typing = () => /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName ?? '');

/** Opens the search on `/` (outside a text field) and on ⌘K or Ctrl+K (anywhere). */
export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const command = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !typing();
      if (!command && !slash) return;
      event.preventDefault();
      open();
    };
    addEventListener('keydown', keydown);
    return () => removeEventListener('keydown', keydown);
  }, [open]);
}
