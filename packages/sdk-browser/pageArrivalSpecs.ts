import {
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
  SLICE_OFFSET_WORDS,
  SLICE_WORDS,
  SPEC_PAGE_INDEX,
  SPEC_STREAM_OFFSET,
  SPEC_TRIANGLES,
} from '../sdk-core/index.ts';
import type { ArrivalPlan } from './pageIntegrationHost.ts';

/** Ce qu'un enregistrement doit à la fiche : sa place dans le paquet, sa taille, son rang de page. */
type SpecRec = { streamOffset?: number; triangles: number };
/** Ce qu'une arrivée écrit sur un enregistrement : sa vue sur le paquet et ce qu'elle pèse. */
type ArrivalRec = SpecRec & { array?: Uint32Array; indexBytes: number };

/**
 * La fiche d'une requête : trois entiers par enregistrement, tirés du seul catalogue.
 *
 * Elle ne dépend d'aucune arrivée — offset dans le paquet, triangles et rang de page sont posés par
 * le compilateur et par la table des pages — donc elle se construit une fois par adresse et se
 * relit ensuite. C'est tout ce que l'exécutant hors fil reçoit : les octets de la page restent chez
 * leur propriétaire.
 */
export function createArrivalSpecs<T extends SpecRec>(
  byUrl: ReadonlyMap<string, T[]>,
  pageIndexOf: (rec: T) => number | undefined,
) {
  const cache = new Map<string, Int32Array>();
  return (url: string) => {
    const known = cache.get(url);
    if (known) return known;
    const recs = byUrl.get(url);
    if (!recs) return undefined;
    const specs = new Int32Array(recs.length * PAGE_SPEC_STRIDE);
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i],
        spec = i * PAGE_SPEC_STRIDE;
      specs[spec + SPEC_STREAM_OFFSET] = rec.streamOffset ?? -1;
      specs[spec + SPEC_TRIANGLES] = rec.triangles;
      specs[spec + SPEC_PAGE_INDEX] = pageIndexOf(rec) ?? -1;
    }
    cache.set(url, specs);
    return specs;
  };
}

/**
 * Pose les vues d'une arrivée depuis son plan, sans en recalculer une seule.
 *
 * Le plan nomme, pour chaque enregistrement et dans l'ordre de la fiche, son premier mot et son
 * nombre de mots : la boucle ne fait plus que poser la vue. Rend faux quand aucun plan n'est arrivé
 * ou qu'il ne décrit pas cette liste — l'appelant refait alors le calcul d'origine, au même
 * résultat. Un plan qui déborderait le paquet arrivé est refusé de la même façon.
 */
export function applyArrivalPlan<T extends ArrivalRec>(
  recs: readonly T[],
  array: Uint32Array,
  plan: ArrivalPlan | undefined,
) {
  if (!plan || plan.count !== recs.length) return false;
  const { slices } = plan;
  for (let i = 0; i < recs.length; i++) {
    const slice = i * PAGE_SLICE_STRIDE,
      from = slices[slice + SLICE_OFFSET_WORDS],
      words = slices[slice + SLICE_WORDS];
    if (from + words > array.length) return false;
    const view = from === 0 && words === array.length ? array : array.subarray(from, from + words);
    recs[i].array = view;
    recs[i].indexBytes = view.byteLength;
  }
  return true;
}
