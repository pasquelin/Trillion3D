import { exampleWord } from './words.ts';

/**
 * The banner over the example, drawn by the page that hosts it (the portal's demo page): at
 * start, the example's line of what to do, `<id>.banner` in its words; then what the example
 * announces — a checkpoint, a crash, a time. Standalone, there is no banner.
 */
let said: string | undefined;

/** Shows `title` over `line` in the banner; both empty, the banner goes. A repeat is not sent. */
export function announce(title: string, line = '') {
  const key = `${title}\n${line}`;
  if (key === said || globalThis.parent === undefined || globalThis.parent === globalThis) return;
  said = key;
  // The words are the example's own, public: any page that frames it may read them.
  globalThis.parent.postMessage({ type: 'trillion3d:banner', title, line }, '*');
}

/** Asks for the example's line of what to do, once its words are read. */
export const announceWhatToDo = () => announce('', exampleWord('', 'banner'));
