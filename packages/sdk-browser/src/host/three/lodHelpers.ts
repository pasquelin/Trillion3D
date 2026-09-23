import type { Page } from '../../../../sdk-core/src/index.ts';

/** The DAG clusters nothing replaces: the coarsest complete cover of a primitive. */
export function collectCover(pages: Page[], out: number[]) {
  for (let id = 0; id < pages.length; id++) if (pages[id].parentError == null) out.push(id);
}
export function buildIndex(pages: Page[], ids: number[], indices: Map<string, Uint32Array>) {
  let count = 0;
  for (const id of ids) {
    const array = indices.get(pages[id].url);
    if (!array) return null;
    count += array.length;
  }
  const out = new Uint32Array(count);
  let offset = 0;
  for (const id of ids) {
    const array = indices.get(pages[id].url)!;
    out.set(array, offset);
    offset += array.length;
  }
  return out;
}
