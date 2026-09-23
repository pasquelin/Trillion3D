import { overlay } from './overlay.ts';
import { exampleWord, labelOf } from './words.ts';

/**
 * A live line at the foot of the example's controls panel: its label, the example's word
 * `<id>.readouts.<key>` (else the key humanised), then whatever the returned
 * function last wrote — a counter the example reads every frame. A write that changes nothing
 * is skipped. Declared after `controls`, whose panel it joins.
 */
export function readout(key: string): (text: string) => void {
  const row = document.createElement('p');
  row.className = 'flex justify-between gap-2 text-xs';
  const name = document.createElement('span');
  name.textContent = exampleWord(labelOf(key), 'readouts', key);
  const value = document.createElement('output');
  value.className = 'font-mono tabular-nums text-primary';
  row.append(name, value);
  const rows = overlay().querySelector('[data-rows]');
  if (!rows) throw new Error(`readout ${key}: declare the controls first`);
  rows.append(row);
  return (text) => {
    if (value.textContent !== text) value.textContent = text;
  };
}
