import { coneSkipsPage } from './pageSelectionHelpers.ts';
import { boxClip, cutSelects, projectedClusterError } from './pageSelectionMath.ts';
import { drawnUnderForcing } from './pageSelectionCutLogic.ts';
import { selectionScratch, type PageRecord, type SelectionState } from './pageSelectionCutState.ts';

/** Frustum test of a page's world box against the selection planes. */
function boxClipRec(min: readonly number[], max: readonly number[]) {
  return boxClip(selectionScratch.planes, min[0], min[1], min[2], max[0], max[1], max[2]);
}

/** Build requested and drawable cuts separately; a resident fallback never hides a missing request. */
function take<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  if (!rec.min || !rec.max) return;
  if (!s.flatInside && boxClipRec(rec.min, rec.max) === 0) {
    s.frustumRejected++;
    return;
  }
  if (
    !(s.flatUseForcing
      ? drawnUnderForcing(s, rec)
      : cutSelects(rec, s.flatElements, s.flatStretch, s.flatFocal, s.camera.near, s.pixelError))
  )
    return;
  if (rec.cone && coneSkipsPage(rec, s.flatWorld, s.camera, rec.min, rec.max)) return;
  if (!s.flatUseForcing) {
    s.wanted.push(rec);
    if (rec.level !== undefined && rec.level > s.lodLevel) s.lodLevel = rec.level;
    if (!s.pageResident(rec)) {
      s.flatMissing = true;
      if (!s.rootFallback) s.complete = false;
      return;
    }
  } else if (!s.pageResident(rec)) {
    s.flatShort = true;
    if (!s.rootFallback) s.complete = false;
    return;
  }
  rec.seen = s.frame;
  s.shown.push(rec);
}

export function flatVisible<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  return !!rec.min && !!rec.max && boxClipRec(rec.min, rec.max) !== 0;
}

export function flatConeKeeps<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  return !rec.cone || !coneSkipsPage(rec, s.flatWorld, s.camera, rec.min!, rec.max!);
}

export function traverse<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  culling?: { nodes: Float64Array; stride: number },
) {
  s.flatInside = false;
  if (!culling) {
    for (let i = 0; i < pages.length; i++) take(s, pages[i]);
    return;
  }
  const { nodes, stride } = culling;
  const { stack, planes } = selectionScratch;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const entry = stack[--top];
    const base = (entry >> 1) * stride;
    let inside = (entry & 1) === 1;
    if (!inside) {
      const clipped = boxClip(
        planes,
        nodes[base],
        nodes[base + 1],
        nodes[base + 2],
        nodes[base + 3],
        nodes[base + 4],
        nodes[base + 5],
      );
      if (clipped === 0) {
        s.frustumRejected++;
        continue;
      }
      inside = clipped === 2;
    }
    const bound = nodes[base + 10];
    if (
      bound >= 0 &&
      projectedClusterError(
        bound,
        nodes,
        base + 6,
        s.flatElements,
        s.flatStretch,
        s.flatFocal,
        s.camera.near,
      ) <= s.pixelError
    )
      continue;
    const children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      if (top + children > stack.length) throw new Error('Pile de culling trop petite');
      const flag = inside ? 1 : 0;
      for (let child = 0; child < children; child++) stack[top++] = ((first + child) << 1) | flag;
      continue;
    }
    s.flatInside = inside;
    const firstPage = nodes[base + 13],
      count = nodes[base + 14];
    for (let i = 0; i < count; i++) take(s, pages[firstPage + i]);
  }
}
