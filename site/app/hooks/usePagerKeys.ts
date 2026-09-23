import { useEffect } from 'react';
import { typing } from './typing.ts';

/** Goes to `previous` on ←, to `next` on →, while the focus is not in a field or an editor and
 * no modifier is held (Alt+← stays the browser's back). */
export function usePagerKeys(previous: string | undefined, next: string | undefined) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        typing()
      )
        return;
      const target =
        event.key === 'ArrowLeft' ? previous : event.key === 'ArrowRight' ? next : undefined;
      if (!target) return;
      event.preventDefault();
      location.assign(target);
    };
    addEventListener('keydown', keydown);
    return () => removeEventListener('keydown', keydown);
  }, [previous, next]);
}
