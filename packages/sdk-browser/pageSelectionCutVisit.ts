import { coneSkipsPage } from './pageSelectionHelpers.ts';
import { boxClip, cutSelects, projectedClusterError } from './pageSelectionMath.ts';
import { cutSelectsAtZero } from './pageSelectionProjection.ts';
import { drawnUnderForcing } from './pageSelectionCutLogic.ts';
import {
  RESIDENT_ALL,
  residentUnder,
  selectionScratch,
  type PageRecord,
  type SelectionState,
} from './pageSelectionCutState.ts';
import { BOUND_STRIDE } from './pageSelectionCutBounds.ts';
import { nodeDecision, nodeDecisionAtZero } from './pageSelectionCutNode.ts';

/** Frustum test of a page's world box against the selection planes. */
function boxClipRec(min: readonly number[], max: readonly number[]) {
  return boxClip(selectionScratch.planes, min[0], min[1], min[2], max[0], max[1], max[2]);
}

/** Retient un cluster déjà choisi : demande, niveau, résidence, estampille.
 *  Build requested and drawable cuts separately; a resident fallback never hides a missing request.
 *  `resident` est la règle de résidence de la coupe, résolue une fois : à `RESIDENT_ALL` il n'y a
 *  rien à lire sur la fiche, et le cluster est retenu sans autre question. */
function keep<T extends PageRecord>(
  s: SelectionState<T>,
  rec: T,
  forcing: boolean,
  resident: number,
) {
  const triangles = rec.triangles;
  if (!forcing) {
    s.wanted.push(rec);
    s.wantedTriangles += triangles;
    const level = rec.level;
    if (level !== undefined && level > s.lodLevel) s.lodLevel = level;
  }
  if (resident !== RESIDENT_ALL && !residentUnder(s, rec, resident)) {
    if (forcing) s.flatShort = true;
    else s.flatMissing = true;
    if (!s.rootFallback) s.complete = false;
    return;
  }
  const shown = s.shown;
  shown.push(rec);
  s.shownTriangles += triangles;
  // Un passage qui dépasse le budget est jeté tel quel : son seul résultat est « trop de pages ».
  // Le savoir au premier dépassement épargne la fin de la descente, pas une page de celle qu'on garde.
  if (s.budget !== 0 && shown.length > s.budget) s.over = true;
}

/** Teste un cluster, sauf sa coupe quand un ancêtre l'a déjà tranchée (`settled`) : le tronc et le
 *  cône restent posés, et l'ordre d'émission reste celui de la descente complète.
 *  `inside`, `forcing`, `exact`, `cones` et `resident` sont constants sous un nœud : la boucle les
 *  passe au lieu de les relire sur l'état à chaque cluster. */
function take<T extends PageRecord>(
  s: SelectionState<T>,
  rec: T,
  settled: boolean,
  inside: boolean,
  forcing: boolean,
  exact: boolean,
  cones: boolean,
  resident: number,
) {
  const min = rec.min,
    max = rec.max;
  if (!min || !max) return;
  if (!inside && boxClipRec(min, max) === 0) {
    s.frustumRejected++;
    return;
  }
  if (
    !settled &&
    !(forcing
      ? drawnUnderForcing(s, rec)
      : exact
        ? cutSelectsAtZero(rec)
        : cutSelects(rec, s.flatElements, s.flatStretch, s.flatFocal, s.camera.near, s.pixelError))
  )
    return;
  if (cones && rec.cone && coneSkipsPage(rec, s.flatCone, s.flatWorld, s.camera, min, max)) return;
  keep(s, rec, forcing, resident);
}

export function flatVisible<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  return !!rec.min && !!rec.max && boxClipRec(rec.min, rec.max) !== 0;
}

export function flatConeKeeps<T extends PageRecord>(s: SelectionState<T>, rec: T) {
  if (!s.flatCones || !rec.cone) return true;
  return !coneSkipsPage(rec, s.flatCone, s.flatWorld, s.camera, rec.min!, rec.max!);
}

export function traverse<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  culling?: { nodes: Float64Array; stride: number; bounds: Float64Array },
) {
  // Le repli par forçage ne teste pas la coupe mais le groupe forcé : les bornes de coupe ne le
  // certifient pas, la descente y reste celle d'avant ce lot.
  const forcing = s.flatUseForcing,
    hierarchical = !forcing,
    exact = s.flatExact,
    cones = s.flatCones,
    resident = s.residentMode;
  if (!culling) {
    for (let i = 0; i < pages.length; i++) {
      take(s, pages[i], false, false, forcing, exact, cones, resident);
      if (s.over) return;
    }
    return;
  }
  const { nodes, stride, bounds } = culling;
  const { stack, planes } = selectionScratch;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    if (s.over) return;
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
      // À seuil nul le plafond du remplaçant ne passe sous le seuil que s'il est nul : même identité
      // que `cutSelectsAtZero`, et pas une projection de plus.
      const bound = nodes[base + 10];
      if (
        exact
          ? bound === 0
          : bound >= 0 &&
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
        const at = node * BOUND_STRIDE;
        const decision = exact ? nodeDecisionAtZero(bounds, at) : nodeDecision(s, bounds, at);
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
    for (let i = 0; i < pageCount; i++) {
      take(s, pages[firstPage + i], settled, inside, forcing, exact, cones, resident);
      if (s.over) return;
    }
  }
}
