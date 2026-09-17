import type { GpuCut, GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import { sameSelectionUniforms } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';
import { copyPages, writeCutPages } from './webgpuPagesHelpers.ts';
import type { CutDelta } from './webgpuCutDelta.ts';
import type { CutCounts } from './webgpuCutCounts.ts';

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
  /** Les totaux de la coupe dessinable, tenus par la différence : ils sont lus, jamais resommés. */
  counts: CutCounts;
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
  /** L'âge de la suite d'identifiants dessinables : il avance à chaque fois qu'un relevé en publie
   *  une autre, adoptée ou non. `shownSeq` est celui de la suite dont `shown` est réellement fait :
   *  un relevé appliqué puis rejeté — uniformes différents, couverture incomplète — les sépare, et
   *  c'est ce qui interdit de tenir `shown` sur une suite que l'image n'a jamais adoptée. */
  let drawnSeq = 0,
    shownSeq = -1;
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
    if (drawnDelta.changed) drawnSeq++;
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
    // `shown` est une fonction de la seule suite d'identifiants dessinables : un relevé neuf qui
    // republie la MÊME suite que celle dont `shown` est fait rend les mêmes fiches, aux mêmes rangs,
    // et ni `shown` ni sa recopie `drawn` ne sont refaits. La comparaison porte sur l'âge de la suite
    // adoptée, pas sur la dernière différence appliquée : un relevé appliqué puis rejeté a fait
    // avancer l'âge sans rien écrire. `shownCut` nul veut dire que ces listes viennent d'ailleurs.
    const held = cut === shownCut || (shownCut !== null && shownSeq === drawnSeq);
    if (!held) {
      writeCutPages(shown, cut.result.drawablePageIds, packedPages);
      copyPages(drawn, shown);
      options.onDrawnMirrored();
      shownCut = cut;
      shownSeq = drawnSeq;
    }
    // Les totaux décrivent l'ensemble que la différence vient de poser, c'est-à-dire exactement les
    // enregistrements de `shown` : ils se lisent, ils ne se recomptent pas.
    const counts = options.counts.totals;
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
    shownSeq = -1;
    options.delta.invalidate();
    options.drawnDelta.invalidate();
  };
  return { adopt, metrics, invalidate };
}
