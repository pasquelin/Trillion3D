import { coneSkipsPage } from './pageSelectionHelpers.ts';
import { boxClip, cutSelects, projectedClusterError } from './pageSelectionMath.ts';
import { drawnUnderForcing } from './pageSelectionCutLogic.ts';
import { selectionScratch, type PageRecord, type SelectionState } from './pageSelectionCutState.ts';
import { BOUND_STRIDE, type CullingBounds } from './pageSelectionCutBounds.ts';
import { nodeDecision } from './pageSelectionCutNode.ts';

/** Frustum test of a page's world box against the selection planes. */
function boxClipRec(min: readonly number[], max: readonly number[]) {
  return boxClip(selectionScratch.planes, min[0], min[1], min[2], max[0], max[1], max[2]);
}

/** Retient un cluster déjà choisi : demande, niveau, résidence, estampille.
 *  Build requested and drawable cuts separately; a resident fallback never hides a missing request. */
function keep<T extends PageRecord>(s: SelectionState<T>, rec: T) {
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
  keep(s, rec);
}

/** Clusters d'une feuille dont un ancêtre a déjà tranché le niveau de détail : le test de coupe
 *  n'est plus posé, et l'ordre d'émission reste celui de la descente complète. */
function emitSettled<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  first: number,
  count: number,
  inside: boolean,
) {
  for (let i = 0; i < count; i++) {
    const rec = pages[first + i];
    if (!rec.min || !rec.max) continue;
    if (!inside && boxClipRec(rec.min, rec.max) === 0) {
      s.frustumRejected++;
      continue;
    }
    if (rec.cone && coneSkipsPage(rec, s.flatWorld, s.camera, rec.min, rec.max)) continue;
    keep(s, rec);
  }
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
  bounds?: CullingBounds,
) {
  s.flatInside = false;
  if (!culling || !bounds) {
    for (let i = 0; i < pages.length; i++) take(s, pages[i]);
    return;
  }
  const { nodes, stride } = culling;
  const { values } = bounds;
  const { stack, planes } = selectionScratch;
  // Le repli par forçage ne teste pas la coupe mais le groupe forcé : les bornes de coupe ne le
  // certifient pas, la descente y reste celle d'avant ce lot.
  const hierarchical = !s.flatUseForcing;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const entry = stack[--top];
    const node = entry >> 2;
    const base = node * stride;
    let inside = (entry & 1) === 1;
    let settled = (entry & 2) === 2;
    // Un nœud déjà tranché et entièrement dans le tronc n'est pas testé : il n'est que traversé.
    if (!inside || !settled) s.nodesTested++;
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
    if (!settled) {
      // Rejet que le manifeste porte déjà : aucun remplaçant encore assez grossier dans le sous-arbre.
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
      if (hierarchical) {
        const decision = nodeDecision(s, values, node * BOUND_STRIDE);
        if (decision < 0) continue;
        settled = decision > 0;
      }
    }
    const children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      if (top + children > stack.length) throw new Error('Pile de culling trop petite');
      const flag = (inside ? 1 : 0) | (settled ? 2 : 0);
      for (let child = 0; child < children; child++) stack[top++] = ((first + child) << 2) | flag;
      continue;
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14];
    if (settled) {
      emitSettled(s, pages, firstPage, pageCount, inside);
      continue;
    }
    s.flatInside = inside;
    for (let i = 0; i < pageCount; i++) take(s, pages[firstPage + i]);
  }
}
