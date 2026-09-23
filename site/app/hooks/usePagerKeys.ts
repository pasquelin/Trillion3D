import { useEffect } from 'react';
import { typing } from './typing.ts';

/** Whether `target` scrolls sideways itself, as a code block with a long line: its arrows are
 * its own. */
const scrollsSideways = (target: EventTarget | null) =>
  target instanceof Element && target.scrollWidth > target.clientWidth;

/** Goes to `previous` on ←, to `next` on →, while the focus is not in a field, an editor or a
 * region that scrolls sideways, and no modifier is held (Alt+← stays the browser's back). */
export function usePagerKeys(previous: string | undefined, next: string | undefined) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        typing() ||
        scrollsSideways(event.target)
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
