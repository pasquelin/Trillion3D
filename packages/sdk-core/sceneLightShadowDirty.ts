import { MAX_SHADOW_SLICES, POINT_FACES } from './sceneLightContracts.ts';
import {
  SHADOW_MASK_BYTES,
  countPages,
  clearFace,
  faceDirty,
  markBoxPages,
  markWholeFace,
  maskBase,
  setRect,
} from './sceneLightShadowPages.ts';

const FACES = MAX_SHADOW_SLICES * POINT_FACES;

/**
 * Les pages périmées de chaque face, et depuis quand.
 *
 * L'état d'une carte d'ombre n'est plus « à jour ou non » mais « quelles pages sont à refaire » : une
 * lampe qui bouge périme sa carte entière, un objet qui bouge ne périme que les pages que sa boîte
 * projetée recouvre. Le moment où une face propre est redevenue sale est gardé tel quel : c'est lui
 * qui donne le retard publié, et il ne repart qu'une fois la dernière page de la face redessinée.
 *
 * Tout est alloué une fois : 64 tranches × 6 faces × 8 octets de masque.
 */
export function createShadowDirty() {
  const mask = new Uint8Array(SHADOW_MASK_BYTES);
  const since = new Float64Array(FACES),
    sinceFrame = new Float64Array(FACES),
    dirty = new Uint8Array(FACES);
  /** Pages entrées en file depuis le début de l'image : un compte brut, jamais une différence. */
  let added = 0;
  const indexOf = (slice: number, face: number) => slice * POINT_FACES + face;
  /** La face attend depuis maintenant, si elle n'attendait pas déjà : le retard ne repart jamais. */
  const waitFrom = (slice: number, face: number, nowMs: number, frame: number) => {
    const index = indexOf(slice, face);
    if (dirty[index]) return;
    dirty[index] = 1;
    since[index] = nowMs;
    sinceFrame[index] = frame;
  };
  /** La face n'attend plus rien : son horodatage repart de zéro avec elle. */
  const forget = (index: number) => {
    dirty[index] = 0;
    since[index] = 0;
    sinceFrame[index] = 0;
  };
  /** Des pages viennent d'entrer en file : elles sont comptées, et la face se met à attendre. */
  const entered = (
    slice: number,
    face: number,
    base: number,
    before: number,
    nowMs: number,
    frame: number,
  ) => {
    added += countPages(mask, base) - before;
    waitFrom(slice, face, nowMs, frame);
  };
  return {
    /** Pages réellement entrées en file depuis le dernier `beginFrame`. */
    get invalidated() {
      return added;
    },
    beginFrame() {
      added = 0;
    },
    /** Vrai si la face porte au moins une page en attente. */
    isDirty: (slice: number, face: number) => dirty[indexOf(slice, face)] === 1,
    /** Retard de la page la plus ancienne de la face, en millisecondes et en images. */
    waitedMs: (slice: number, face: number, nowMs: number) => {
      const index = indexOf(slice, face);
      return dirty[index] ? nowMs - since[index] : 0;
    },
    waitedFrames: (slice: number, face: number, frame: number) => {
      const index = indexOf(slice, face);
      return dirty[index] ? frame - sinceFrame[index] : 0;
    },
    pages: (slice: number, face: number) => countPages(mask, maskBase(slice, face)),
    row: (slice: number, face: number, row: number) => mask[maskBase(slice, face) + row],
    /** Toute la face est à refaire : lampe déplacée, tranche réallouée, cascade déplacée, première image. */
    whole(slice: number, face: number, rows: number, nowMs: number, frame: number) {
      const base = maskBase(slice, face);
      const before = countPages(mask, base);
      markWholeFace(mask, base, rows);
      entered(slice, face, base, before, nowMs, frame);
    },
    /** Les pages que la boîte monde recouvre dans cette face, et elles seules. */
    box(
      slice: number,
      face: number,
      rows: number,
      matrix: Float32Array,
      matrixBase: number,
      min: ArrayLike<number>,
      max: ArrayLike<number>,
      nowMs: number,
      frame: number,
    ) {
      const base = maskBase(slice, face);
      const before = countPages(mask, base);
      if (!markBoxPages(mask, base, rows, matrix, matrixBase, min, max)) return false;
      entered(slice, face, base, before, nowMs, frame);
      return true;
    },
    /** Une région vient d'être redessinée : ses pages ne sont plus en attente. */
    drew(slice: number, face: number, x0: number, x1: number, y0: number, y1: number) {
      const base = maskBase(slice, face);
      setRect(mask, base, x0, x1, y0, y1, false);
      if (!faceDirty(mask, base)) forget(indexOf(slice, face));
    },
    /**
     * La région n'a finalement pas été dessinée — la passe n'a pas pu être encodée — : ses pages
     * retournent en file. Sans cela, une carte garderait une profondeur périmée sans que rien ne le
     * dise.
     */
    undrew(
      slice: number,
      face: number,
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      nowMs: number,
      frame: number,
    ) {
      setRect(mask, maskBase(slice, face), x0, x1, y0, y1, true);
      // Ces pages avaient déjà été comptées à leur entrée en file : elles y reviennent, sans
      // repasser par `added`, qui compte les entrées et non les allers-retours.
      waitFrom(slice, face, nowMs, frame);
    },
    /** La tranche est libérée ou reprise : plus aucune page ne l'attend. */
    reset(slice: number) {
      for (let face = 0; face < POINT_FACES; face++) {
        clearFace(mask, maskBase(slice, face));
        forget(indexOf(slice, face));
      }
    },
  };
}

export type ShadowDirty = ReturnType<typeof createShadowDirty>;
