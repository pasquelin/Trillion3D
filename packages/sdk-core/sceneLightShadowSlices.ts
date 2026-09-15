import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import { createShadowAtlas } from './sceneLightShadowAtlas.ts';

/** Rectangles d'une tranche : `(x, y, côté)` par face, six faces réservées pour toute tranche. */
export const RECTS_PER_SLICE = POINT_FACES * 3;

/**
 * La table des tranches d'ombre : quelle tranche est prise, à quel côté, et l'état de fraîcheur
 * qui décide qu'une tranche en cache est périmée. Tout est alloué une fois ; une tranche ne se
 * réalloue que lorsque le nombre de faces change ou que le côté voulu double ou se divise par deux.
 */
export function createShadowSliceTable() {
  const atlas = createShadowAtlas();
  const rects = new Int32Array(MAX_SHADOW_SLICES * RECTS_PER_SLICE);
  /** Une tranche prise, sans dire par qui : le magasin porte déjà le lien lampe → tranche. */
  const taken = new Uint8Array(MAX_SHADOW_SLICES);
  const faces = new Int32Array(MAX_SHADOW_SLICES),
    side = new Int32Array(MAX_SHADOW_SLICES),
    revision = new Uint32Array(MAX_SHADOW_SLICES),
    movedEpoch = new Uint32Array(MAX_SHADOW_SLICES),
    drawn = new Uint8Array(MAX_SHADOW_SLICES);
  const table = {
    atlas,
    rects,
    faces,
    side,
    revision,
    movedEpoch,
    drawn,
    free(slice: number) {
      if (slice < 0) return;
      atlas.release(faces[slice], rects, slice * RECTS_PER_SLICE);
      taken[slice] = 0;
      faces[slice] = 0;
      side[slice] = 0;
      drawn[slice] = 0;
    },
    /** La première tranche libre, ou −1 quand les 64 tranches publiées sont prises. */
    claim() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++)
        if (!taken[slice]) {
          taken[slice] = 1;
          revision[slice] = 0;
          movedEpoch[slice] = 0;
          drawn[slice] = 0;
          return slice;
        }
      return -1;
    },
    /**
     * Assure que la tranche porte `wantedFaces` faces au côté `wantedSide`. Rend le côté obtenu, ou 0
     * si l'atlas ne peut pas la placer : la tranche est alors libérée et la lampe reste sans ombre.
     */
    fit(slice: number, wantedFaces: number, wantedSide: number) {
      const keep =
        faces[slice] === wantedFaces &&
        side[slice] > 0 &&
        wantedSide < side[slice] * 2 &&
        wantedSide * 2 > side[slice];
      if (keep) return side[slice];
      atlas.release(faces[slice], rects, slice * RECTS_PER_SLICE);
      const got = atlas.allocate(wantedFaces, wantedSide, rects, slice * RECTS_PER_SLICE);
      faces[slice] = got ? wantedFaces : 0;
      side[slice] = got;
      drawn[slice] = 0;
      if (!got) taken[slice] = 0;
      return got;
    },
    /** Marque la tranche comme dessinée à cette révision de lampe et cet état du monde. */
    refreshed(slice: number, lightRevision: number, worldEpoch: number) {
      revision[slice] = lightRevision;
      movedEpoch[slice] = worldEpoch;
      drawn[slice] = 1;
    },
    stale(slice: number, lightRevision: number, worldEpoch: number, touched: boolean) {
      return (
        !drawn[slice] ||
        revision[slice] !== lightRevision ||
        (movedEpoch[slice] !== worldEpoch && touched)
      );
    },
    reset() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) table.free(slice);
    },
  };
  return table;
}
