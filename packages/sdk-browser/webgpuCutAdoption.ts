import type { GpuCut, GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import { sameSelectionUniforms } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';
import { copyPages, shownFromGpu } from './webgpuPagesHelpers.ts';
import type { CutDelta } from './webgpuCutDelta.ts';

/**
 * Applies a completed readback without letting it decide the current-frame draw mask.
 *
 * The readback is taken as a difference: a cut this adopter has already seen enters and leaves no
 * page at all, and a cut that moved names only what moved. `desired` keeps that difference as its
 * opaque head and the transparent cut as its tail, so the steps that follow read a set that survived
 * the previous image rather than one rebuilt from fifteen thousand records.
 */
export function createWebgpuCutAdopter(options: {
  selection: () => GpuSelection | undefined;
  packedPages: PageRec[];
  desired: PageRec[];
  shown: PageRec[];
  drawn: PageRec[];
  uniforms: SelectionUniforms;
  residentOffsetWords: Int32Array;
  delta: CutDelta;
  /** The drawable cut as a difference, kept apart because it is not the cut that was asked for. */
  drawnDelta: CutDelta;
  /** Called once per readback, and only there: the difference is applied exactly once. */
  onCutDelta: (delta: CutDelta) => void;
  onDrawnDelta: (delta: CutDelta) => void;
  /** Appelée quand `drawn` vient d'être refait depuis `shown` : l'image n'a plus à le refaire. */
  onDrawnMirrored: () => void;
}) {
  const metrics = {
    /** Vrai quand l'image a relu le relevé qu'elle tenait déjà : `desired` et `shown` sont ceux de
     *  l'image précédente, aux mêmes rangs. Faux par défaut, et faux dès qu'un doute existe. */
    cutHeld: false,
    /** Vrai quand cette adoption a réellement réécrit `desired` ou `shown`. L'adoption ne se produit
     *  pas qu'au rendu : la vidange en rejoue une après coup, donc tout lecteur de ces listes doit
     *  savoir qu'elles ont bougé sous lui, pas seulement que l'image en cours les tenait. */
    listsRewritten: false,
    /** Vrai quand le relevé adopté déclare une couverture incomplète : une page que le noyau veut
     *  dessiner n'est pas encore arrivée. L'image ATTEND cette page, elle ne jette pas la sélection
     *  GPU — le repli processeur est réservé à un échec réel de la sélection. */
    incomplete: false,
    ready: false,
    visible: 0,
    selectedTriangles: 0,
    uncoveredTriangles: 0,
    /** La part de la coupe qui part au dessin : `selectedTriangles` moins le trou. */
    drawnTriangles: 0,
    transparentTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
  };
  let lastCut: GpuCut | null = null;
  /** Le relevé dont `shown` et `drawn` sont faits, ou `null` quand ils viennent d'ailleurs. */
  let shownCut: GpuCut | null = null;
  const adopt = () => {
    metrics.cutHeld = false;
    metrics.listsRewritten = false;
    metrics.incomplete = false;
    const cut = options.selection()?.peek();
    if (!cut?.result.drawablePageIds) return false;
    const { packedPages, desired, shown, drawn, delta, drawnDelta } = options;
    if (cut === lastCut) {
      delta.hold();
      drawnDelta.hold();
    } else {
      delta.apply(cut.result.pageIds);
      drawnDelta.apply(cut.result.drawablePageIds);
      lastCut = cut;
    }
    // A difference is applied where it is computed. An image that adopts nothing — no readback has
    // landed — must not replay the previous one, which would count every page twice.
    options.onCutDelta(delta);
    options.onDrawnDelta(drawnDelta);
    metrics.cutHeld = !delta.changed && !drawnDelta.changed;
    metrics.listsRewritten = !metrics.cutHeld;
    metrics.visible = desired.length;
    if (!sameSelectionUniforms(cut.uniforms, options.uniforms)) return false;
    if (cut.result.complete === false) {
      metrics.incomplete = true;
      return false;
    }
    // Le contenu de `shown` est une fonction du seul relevé : les mêmes identifiants, lus dans le
    // même catalogue, rendent les mêmes enregistrements dans le même ordre. Un relevé dont ils sont
    // déjà faits ne les refait donc pas — seuls les comptes sont relus, et eux seuls dépendent de la
    // résidence. La liste est parcourue une fois au lieu d'être vidée puis repoussée trois fois.
    // `shown` est une fonction de la seule suite d'identifiants dessinables : un relevé neuf qui
    // republie la même suite rend les mêmes fiches, aux mêmes rangs. La différence vient de le dire,
    // donc ni `shown` ni sa recopie `drawn` ne sont refaits. `shownCut` nul veut dire que ces listes
    // viennent d'ailleurs — la coupe processeur les a réécrites — et là tout est refait.
    const held = cut === shownCut || (shownCut !== null && !drawnDelta.changed);
    const counts = shownFromGpu(
      packedPages,
      cut.result.drawablePageIds,
      held ? undefined : shown,
      options.residentOffsetWords,
    );
    if (!held) {
      copyPages(drawn, shown);
      options.onDrawnMirrored();
      shownCut = cut;
    }
    metrics.ready = true;
    metrics.selectedTriangles = counts.selectedTriangles;
    metrics.uncoveredTriangles = counts.uncoveredTriangles;
    metrics.drawnTriangles = counts.drawnTriangles;
    metrics.transparentTriangles = counts.transparentTriangles;
    metrics.frustumRejected = cut.result.frustumRejected;
    metrics.lodLevel = cut.result.lodLevel;
    return true;
  };
  /** Forgets the cut held: the CPU cut rewrote the arrays this adopter maintains. */
  const invalidate = () => {
    lastCut = null;
    shownCut = null;
    options.delta.invalidate();
    options.drawnDelta.invalidate();
  };
  return { adopt, metrics, invalidate };
}
