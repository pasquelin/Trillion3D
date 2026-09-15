import { lightDirection, type SceneLight, type ShadowViewpoint } from './sceneLightContracts.ts';
import type { createShadowChanges } from './sceneLightShadowChanges.ts';
import { writeFace } from './sceneLightShadowFaces.ts';
import { pageRowsOf } from './sceneLightShadowPages.ts';
import type { createShadowSliceTable } from './sceneLightShadowSlices.ts';
import { sunCascadeOf } from './sceneLightSunCascades.ts';

/** La matrice d'une face, le temps de projeter une boîte : allouée une fois, jamais par image. */
const matrix = new Float32Array(16);

/**
 * Ce qui périme les pages d'une lampe à ombre, et rien de plus.
 *
 * - **La lampe a bougé, changé de portée ou de tranche** : toutes ses cartes sont fausses, toutes
 *   leurs pages repartent en attente.
 * - **Une cascade du soleil décrit une autre fenêtre du monde** : cette cascade-là repart entière.
 *   Tant que la fenêtre est la même — caméra immobile, ou déplacement inférieur à un texel de la
 *   grille d'alignement —, la carte est gardée telle quelle, même si la caméra a bougé.
 * - **Un objet a bougé dans la portée de la lampe** : seules les pages que sa boîte projetée recouvre
 *   repartent. Le reste de la face décrit toujours la scène, puisque rien d'autre n'a changé.
 */
export function invalidateLightPages(
  slices: ReturnType<typeof createShadowSliceTable>,
  changes: ReturnType<typeof createShadowChanges>,
  light: SceneLight,
  slice: number,
  faceCount: number,
  side: number,
  lightRevision: number,
  view: ShadowViewpoint,
  nowMs: number,
  frame: number,
  byPage: boolean,
) {
  const { dirty } = slices;
  const rows = pageRowsOf(side);
  const whole = !slices.noted[slice] || slices.revision[slice] !== lightRevision;
  const sun = light.kind === 'directional';
  const range = sun ? 0 : (light.range ?? 0);
  const x = light.position?.[0] ?? 0,
    y = light.position?.[1] ?? 0,
    z = light.position?.[2] ?? 0;
  for (let face = 0; face < faceCount; face++) {
    let all = whole;
    if (sun) {
      const cascade = sunCascadeOf(view, lightDirection(light), face, side);
      if (slices.cascadeChanged(slice, face, cascade.center, cascade.radius)) all = true;
    }
    if (all) {
      dirty.whole(slice, face, rows, nowMs, frame);
      continue;
    }
    let ready = false;
    for (let box = 0; box < changes.count; box++) {
      if (!changes.touches(box, x, y, z, range)) continue;
      // Sans l'invalidation par pages, toute la face repart : c'est le comportement d'avant le lot,
      // gardé pour que la preuve d'identité compare deux fois le même moteur.
      if (!byPage) {
        dirty.whole(slice, face, rows, nowMs, frame);
        break;
      }
      if (!ready) {
        writeFace(matrix, 0, null, 0, light, face, view, side);
        ready = true;
      }
      const moved = changes.read(box);
      dirty.box(slice, face, rows, matrix, 0, moved.min, moved.max, nowMs, frame);
    }
  }
  slices.noteRevision(slice, lightRevision);
}
