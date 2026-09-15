import { TRANSPARENT_GROUP, TRANSPARENT_NONE } from './webgpuTransparentTable.ts';

/**
 * The compaction the GPU performs, written once in plain arithmetic.
 *
 * Both the shader and this function answer the same question: of the catalogue's transparent
 * clusters, in catalogue order, which ones did the frame's cut select, and where does each item's
 * surviving list start. Keeping the answer in one place lets a test state the contract — the output
 * is the input order with the unselected entries removed — and lets the mock device replay it.
 */
export function evaluateTransparentCompaction(input: {
  entries: Uint32Array;
  itemRanges: Uint32Array;
  entryCount: number;
  itemCount: number;
  vertexCount: number;
  selected: (cluster: number) => boolean;
}) {
  const { entries, itemRanges, entryCount, itemCount, vertexCount } = input;
  const keeps = (entry: number) =>
    entry < entryCount && entries[entry] !== TRANSPARENT_NONE && input.selected(entries[entry]);
  const instances = new Uint32Array(entries.length);
  const indirect = new Uint32Array(Math.max(1, itemCount) * 4);
  for (let item = 0; item < itemCount; item++) {
    const base = itemRanges[item * 2],
      held = itemRanges[item * 2 + 1];
    let at = base;
    for (let i = base; i < base + Math.ceil(held / TRANSPARENT_GROUP) * TRANSPARENT_GROUP; i++)
      if (keeps(i)) instances[at++] = i;
    indirect[item * 4] = vertexCount;
    indirect[item * 4 + 1] = at - base;
  }
  return { instances, indirect };
}
