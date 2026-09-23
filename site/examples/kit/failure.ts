import { overlay } from './overlay.ts';
import { kitWord } from './words.ts';

/**
 * What the reader sees when the example stops on an error — a model that did not load, a device
 * the engine refused: a card over the render naming the error, instead of a black page.
 */
let shown: HTMLElement | undefined;

/** The card, once: the first error is the one that stopped the page. */
function showFailure(error: unknown) {
  if (shown) return;
  shown = document.createElement('div');
  shown.role = 'alert';
  shown.className =
    'pointer-events-auto absolute inset-x-3 top-3 mx-auto max-w-lg alert alert-soft alert-error';
  const title = document.createElement('strong');
  title.textContent = kitWord('failure', 'title', 'This example stopped on an error');
  const detail = document.createElement('p');
  detail.className = 'text-xs break-words';
  detail.textContent = error instanceof Error ? error.message : String(error);
  const text = document.createElement('div');
  text.append(title, detail);
  shown.append(text);
  overlay().append(shown);
}

/** Shows any error the example's own code leaves uncaught: an `await` that rejects at the top
 *  of its module is one. An error event without an error (a resize notice) is not one. */
export function watchFailures() {
  globalThis.addEventListener?.('error', (event) => {
    if (event.error) showFailure(event.error);
  });
  globalThis.addEventListener?.('unhandledrejection', (event) => showFailure(event.reason));
}
