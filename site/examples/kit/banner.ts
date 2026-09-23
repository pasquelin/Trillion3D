import { panel } from './overlay.ts';

/**
 * A short card in the top-left corner of the example: what you see (`title`) and what to try
 * (`tip`). The returned `tip` rewrites the second line; `status` writes a third, live one — a
 * counter, a reading. Both skip a write that changes nothing, so they can be called every frame.
 */
export function banner(title: string, tip: string) {
  const card = panel('top-3 left-3 max-w-[min(24rem,calc(100vw-1.5rem))] gap-1 px-4 py-3');
  const heading = document.createElement('h1');
  heading.className = 'font-semibold';
  heading.textContent = title;
  const hint = document.createElement('p');
  hint.className = 'text-xs opacity-80';
  hint.textContent = tip;
  const line = document.createElement('p');
  line.className = 'font-mono text-xs text-primary empty:hidden';
  card.append(heading, hint, line);
  const writer = (element: HTMLElement) => (text: string) => {
    if (element.textContent !== text) element.textContent = text;
  };
  return { tip: writer(hint), status: writer(line) };
}
