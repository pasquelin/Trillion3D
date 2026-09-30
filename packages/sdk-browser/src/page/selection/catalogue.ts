import type { PageRec } from './types.ts';

/**
 * The one catalogue accessor of an engine.
 *
 * A packed rank is the engine's identity for an instance — a (placement, page) pair — and this is
 * the only way a consumer turns it back into a record: `recordOf(packed)`. A rank outside the
 * catalogue yields nothing, like an id missing from the table. One record serves every placement of
 * its primitive (#1235), so a record names no single packed rank: the reverse direction does not
 * exist, and a reader that needs one takes it from the placement tables the layout owns.
 *
 * The cut and the residency route by packed ranks; no consumer builds a second catalogue or a
 * second record reference beside this one (#483 rule 4). Both backends share it (#1233, #1234).
 */
export type PageCatalogue = ReturnType<typeof createPageCatalogue>;

export function createPageCatalogue(packedPages: readonly PageRec[]) {
  const recordOf = (packed: number) => (packed >= 0 ? packedPages[packed] : undefined);
  return { recordOf };
}
