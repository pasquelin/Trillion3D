import { hideable, overlay } from './overlay.ts';
import { isCapture } from './play.ts';
import { exampleWord, kitWord } from './words.ts';

/**
 * The banner over the example, drawn by the example itself at the top of its frame: at start,
 * its line of what to do, `<id>.banner` in its words; then what it announces — a checkpoint, a
 * time, the microphone it listens to. The reader may close it; the page's show/hide of the panels
 * hides it too, and a page opened for a screenshot (`?capture`) never shows it.
 */
let said: string | undefined;
let card: HTMLElement | undefined;
let heading: HTMLElement;
let text: HTMLElement;

/** The banner's card, built once and kept for every announcement. */
function banner(): HTMLElement {
  if (card) return card;
  card = document.createElement('div');
  card.role = 'status';
  card.className =
    'pointer-events-auto absolute inset-x-3 top-3 mx-auto max-w-md alert alert-soft alert-info py-2 text-sm';
  heading = document.createElement('strong');
  heading.className = 'block text-lg';
  text = document.createElement('span');
  const words = document.createElement('p');
  words.append(heading, text);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-sm btn-circle';
  close.ariaLabel = kitWord('banner', 'close', 'Close');
  close.textContent = '×';
  close.addEventListener('click', () => card?.remove());
  card.append(words, close);
  hideable(card);
  return card;
}

/** Shows `title`, large, over `line` in the banner; both empty, the banner goes. A repeat of what
 *  it already says changes nothing, so a banner the reader closed stays closed. */
export function announce(title: string, line = '') {
  const key = `${title}\n${line}`;
  if (key === said || !globalThis.document || isCapture(document)) return;
  said = key;
  const shown = banner();
  if (!title && !line) return shown.remove();
  heading.textContent = title;
  heading.hidden = !title;
  text.textContent = line;
  overlay().append(shown);
}

/** Shows the example's line of what to do, once its words are read. */
export const announceWhatToDo = () => announce('', exampleWord('', 'banner'));
