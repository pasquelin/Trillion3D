import { LIGHT_SETTINGS, POINT_FACES } from './sceneLightContracts.ts';

/** Côté d'une cellule de base de l'atlas : la plus petite tranche que le contrat publie. */
const CELL = LIGHT_SETTINGS.shadowSliceMin;
/** Cellules de base par côté d'atlas. 4096 / 128 = 32, soit 1024 cellules. */
const GRID = Math.floor(LIGHT_SETTINGS.shadowAtlasSize / CELL);
/** Côtés de face que l'atlas sait placer, du plus grand au plus petit. */
export const SHADOW_FACE_SIDES: readonly number[] = (() => {
  const sides: number[] = [];
  for (let side: number = LIGHT_SETTINGS.shadowSliceMax; side >= CELL; side = Math.floor(side / 2))
    sides.push(side);
  return sides;
})();

/**
 * Placement des faces dans l'atlas de profondeur. Chaque face occupe un bloc carré aligné de
 * `k × k` cellules de base ; une ponctuelle en réserve six, un projecteur une. Le placement ne
 * change que lorsqu'une lampe acquiert ou libère sa tranche, jamais par image, et l'occupation est
 * un seul tableau d'octets alloué une fois.
 */
export function createShadowAtlas() {
  const used = new Uint8Array(GRID * GRID);
  const free = (cx: number, cy: number, k: number) => {
    if (cx + k > GRID || cy + k > GRID) return false;
    for (let y = cy; y < cy + k; y++)
      for (let x = cx; x < cx + k; x++) if (used[y * GRID + x]) return false;
    return true;
  };
  const mark = (cx: number, cy: number, k: number, value: number) => {
    for (let y = cy; y < cy + k; y++) for (let x = cx; x < cx + k; x++) used[y * GRID + x] = value;
  };
  /** Un bloc aligné sur sa propre taille : la recherche reste un balayage borné par la grille. */
  const claim = (k: number) => {
    for (let cy = 0; cy + k <= GRID; cy += k)
      for (let cx = 0; cx + k <= GRID; cx += k)
        if (free(cx, cy, k)) {
          mark(cx, cy, k, 1);
          return [cx, cy] as const;
        }
    return undefined;
  };
  return {
    size: LIGHT_SETTINGS.shadowAtlasSize,
    cell: CELL,
    grid: GRID,
    /** Cellules occupées sur le total : ce que le diagnostic publie comme charge de l'atlas. */
    occupancy() {
      let count = 0;
      for (let i = 0; i < used.length; i++) count += used[i];
      return { used: count, total: used.length };
    },
    /**
     * Réserve `faces` blocs de côté `side` texels et écrit leurs rectangles `(x, y, côté)` dans
     * `rects`. Rend le côté réellement obtenu, ou 0 si l'atlas est plein même au côté minimal : la
     * lampe reste alors sans ombre, ce que le diagnostic déclare.
     */
    allocate(faces: number, side: number, rects: Int32Array, base: number) {
      for (const candidate of SHADOW_FACE_SIDES) {
        if (candidate > side) continue;
        const k = candidate / CELL;
        let placed = 0;
        for (; placed < faces; placed++) {
          const spot = claim(k);
          if (!spot) break;
          rects[base + placed * 3] = spot[0] * CELL;
          rects[base + placed * 3 + 1] = spot[1] * CELL;
          rects[base + placed * 3 + 2] = candidate;
        }
        if (placed === faces) return candidate;
        for (let i = 0; i < placed; i++)
          mark(rects[base + i * 3] / CELL, rects[base + i * 3 + 1] / CELL, k, 0);
      }
      for (let i = 0; i < faces * 3; i++) rects[base + i] = 0;
      return 0;
    },
    release(faces: number, rects: Int32Array, base: number) {
      for (let i = 0; i < faces; i++) {
        const side = rects[base + i * 3 + 2];
        if (side <= 0) continue;
        mark(rects[base + i * 3] / CELL, rects[base + i * 3 + 1] / CELL, side / CELL, 0);
        rects[base + i * 3] = 0;
        rects[base + i * 3 + 1] = 0;
        rects[base + i * 3 + 2] = 0;
      }
    },
  };
}

/**
 * Côté de face que mérite une lampe : sa portée projetée à l'écran, plafonnée par sa part de
 * l'atlas. Une lampe qui couvre tout l'écran et qui est seule prend `shadowSliceMax` ; à trente
 * lampes à ombre, chacune descend d'elle-même plutôt que de laisser les dernières sans tranche.
 * Le plancher est `shadowSliceMin` : aucune lampe ne disparaît faute de place tant qu'il en reste.
 */
export function desiredFaceSide(screenCoverage: number, faces: number, casters = 1) {
  // Une ponctuelle paie six faces : elle en demande donc un côté de moins qu'un projecteur.
  const wanted =
    (Math.sqrt(Math.max(0, Math.min(1, screenCoverage))) * LIGHT_SETTINGS.shadowSliceMax) /
    (faces === POINT_FACES ? 2 : 1);
  // Part d'atlas d'une lampe : `GRID²` cellules partagées entre les demandeurs, `faces` par lampe.
  const share = Math.sqrt((GRID * GRID) / Math.max(1, casters * faces)) * CELL;
  const budget = Math.max(LIGHT_SETTINGS.shadowSliceMin, Math.min(wanted, share));
  let chosen: number = LIGHT_SETTINGS.shadowSliceMin;
  for (const side of SHADOW_FACE_SIDES)
    if (side <= budget) {
      chosen = side;
      break;
    }
  return chosen;
}
