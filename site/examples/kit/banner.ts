import { hideable, overlay } from './overlay.ts';
import { isCapture } from './play.ts';
import { exampleWord, kitWord } from './words.ts';

/**
 * The banner over the example, drawn by the example itself at the top of its frame: at start,
 * its line of what to do, `<id>.banner` in its words; then what it announces — a checkpoint, a
 * time, the microphone it listens to. Emptied out (`announce('')`), it falls back to that line
 * of what to do rather than vanishing. The reader may close it with its ×; from there, a return
 * to the line of what to do leaves it closed, but a real announcement (a title, or a line) opens
 * it again. The page's show/hide of the panels hides it too, and a page opened for a screenshot
 * (`?capture`) never shows it.
 */
let said: string | undefined;
let closed = false;
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
  close.addEventListener('click', () => {
    closed = true;
    card?.remove();
  });
  card.append(words, close);
  hideable(card);
  return card;
}

/** Shows `title`, large, over `line` in the banner; both empty, the example's own line of what
 *  to do takes their place, without a title. A repeat of what it already shows changes nothing.
 *  The reader's × closes the banner; a further return to the line of what to do leaves it closed,
 *  but a title or a line reopens it. */
export function announce(title: string, line = '') {
  const backToWhatToDo = !title && !line;
  const shownLine = backToWhatToDo ? exampleWord('', 'banner') : line;
  if (!globalThis.document || isCapture(document)) return;
  if (backToWhatToDo && closed) return;
  const shown = banner();
  const key = `${title}\n${shownLine}`;
  if (key === said && shown.isConnected) return;
  said = key;
  if (!backToWhatToDo) closed = false;
  heading.textContent = title;
  heading.hidden = !title;
  text.textContent = shownLine;
  overlay().append(shown);
}

/** Shows the example's line of what to do, once its words are read. */
export const announceWhatToDo = () => announce('', exampleWord('', 'banner'));
