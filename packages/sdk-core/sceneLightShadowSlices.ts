import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import { createShadowAtlas } from './sceneLightShadowAtlas.ts';
import { createShadowDirty } from './sceneLightShadowDirty.ts';

/** Rectangles d'une tranche : `(x, y, côté)` par face, six faces réservées pour toute tranche. */
export const RECTS_PER_SLICE = POINT_FACES * 3;
/** Clé d'une cascade : centre aligné sur la grille de texels et rayon. Quatre nombres, pas un de plus. */
const CASCADE_KEY = 4;

/**
 * La table des tranches d'ombre : quelle tranche est prise, à quel côté, quelles pages de quelle face
 * attendent leur dessin, et — pour une cascade du soleil — la fenêtre monde que sa carte décrit.
 *
 * Une carte n'est plus « à jour ou périmée » : elle porte des pages en attente. Une lampe qui bouge
 * les périme toutes ; un objet qui bouge n'en périme que quelques-unes. Tout est alloué une fois ;
 * une tranche ne se réalloue que lorsque le nombre de faces change ou que le côté voulu double ou se
 * divise par deux.
 */
export function createShadowSliceTable() {
  const atlas = createShadowAtlas();
  const dirty = createShadowDirty();
  const rects = new Int32Array(MAX_SHADOW_SLICES * RECTS_PER_SLICE);
  /** Une tranche prise, sans dire par qui : le magasin porte déjà le lien lampe → tranche. */
  const taken = new Uint8Array(MAX_SHADOW_SLICES);
  const faces = new Int32Array(MAX_SHADOW_SLICES),
    side = new Int32Array(MAX_SHADOW_SLICES),
    revision = new Uint32Array(MAX_SHADOW_SLICES),
    noted = new Uint8Array(MAX_SHADOW_SLICES),
    drawn = new Uint8Array(MAX_SHADOW_SLICES),
    /** Fenêtre monde de chaque cascade au dernier dessin : le soleil suit la caméra, pas la lampe. */
    cascade = new Float64Array(MAX_SHADOW_SLICES * POINT_FACES * CASCADE_KEY),
    cascadeSeen = new Uint8Array(MAX_SHADOW_SLICES * POINT_FACES);
  const table = {
    atlas,
    dirty,
    rects,
    /** Les tranches prises, pour que la libération sache lesquelles plus aucune lampe ne réclame. */
    taken,
    faces,
    side,
    revision,
    noted,
    drawn,
    free(slice: number) {
      if (slice < 0) return;
      atlas.release(faces[slice], rects, slice * RECTS_PER_SLICE);
      dirty.reset(slice);
      taken[slice] = 0;
      faces[slice] = 0;
      side[slice] = 0;
      noted[slice] = 0;
      drawn[slice] = 0;
      for (let face = 0; face < POINT_FACES; face++) cascadeSeen[slice * POINT_FACES + face] = 0;
    },
    /** La première tranche libre, ou −1 quand les 64 tranches publiées sont prises. */
    claim() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++)
        if (!taken[slice]) {
          taken[slice] = 1;
          revision[slice] = 0;
          noted[slice] = 0;
          drawn[slice] = 0;
          dirty.reset(slice);
          return slice;
        }
      return -1;
    },
    /**
     * Assure que la tranche porte `wantedFaces` faces au côté `wantedSide`. Rend le côté obtenu, ou 0
     * si l'atlas ne peut pas la placer : la tranche est alors libérée et la lampe reste sans ombre.
     * Une réallocation donne des texels neufs, donc toutes les pages repartent en attente.
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
      noted[slice] = 0;
      drawn[slice] = 0;
      dirty.reset(slice);
      if (!got) taken[slice] = 0;
      return got;
    },
    /**
     * L'invalidation de cette révision de lampe est **enregistrée** : ce sont les pages qui portent
     * désormais le travail restant. Sans cette marque, une lampe déplacée reverrait sa face entière
     * remise en attente à chaque image et n'avancerait jamais.
     */
    noteRevision(slice: number, lightRevision: number) {
      revision[slice] = lightRevision;
      noted[slice] = 1;
    },
    /** Une région de la tranche a été dessinée : elle n'est plus une tranche vierge. */
    markDrawn(slice: number) {
      drawn[slice] = 1;
    },
    /**
     * La fenêtre monde d'une cascade a-t-elle changé depuis son dernier dessin ? Une cascade suit la
     * caméra : tant que son centre aligné et son rayon sont les mêmes, sa carte décrit exactement la
     * même chose et se garde. Dès qu'ils changent, la carte décrit une autre fenêtre du monde et
     * aucun de ses texels ne vaut plus rien — l'atlas n'adresse pas ses pages en anneau, donc il n'y
     * a rien à récupérer d'un glissement, et la cascade se redessine entière.
     */
    cascadeChanged(slice: number, face: number, center: ArrayLike<number>, radius: number) {
      const index = slice * POINT_FACES + face,
        base = index * CASCADE_KEY;
      const same =
        cascadeSeen[index] === 1 &&
        cascade[base] === center[0] &&
        cascade[base + 1] === center[1] &&
        cascade[base + 2] === center[2] &&
        cascade[base + 3] === radius;
      if (same) return false;
      cascadeSeen[index] = 1;
      cascade[base] = center[0];
      cascade[base + 1] = center[1];
      cascade[base + 2] = center[2];
      cascade[base + 3] = radius;
      return true;
    },
    reset() {
      for (let slice = 0; slice < MAX_SHADOW_SLICES; slice++) table.free(slice);
    },
  };
  return table;
}
