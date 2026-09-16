import {
  FRUSTUM_PLANE_VALUES,
  frustumPlanesFromMatrix,
  multiplyMatrix4,
  viewToRenderOrigin,
} from '../sdk-core/index.ts';

/**
 * LA MOITIÉ CAMÉRA DU REPÈRE DE RENDU (`sdk-core/mathRenderOrigin.ts` porte la règle et son
 * pourquoi). L'origine du repère est l'œil de l'image ; la caméra y est donc posée à zéro, et sa
 * vue n'est plus que son orientation. Ces trois matrices sont calculées UNE FOIS par image, en
 * double précision, dans la caméra du moteur, en même temps que leurs jumelles absolues.
 *
 * LES DEUX MOITIÉS NE SE MÉLANGENT PAS. Ce qui part vers la carte graphique avec des matrices monde
 * ramenées à l'œil lit `viewRelative` et `planesRelative` ; ce qui reste en double précision côté
 * processeur — coupe exacte, Hi-Z, priorité de flux, éclairage, diagnostics — garde `view`,
 * `viewProjection` et `planes`, qui décrivent le même monde sans rien perdre à cette distance.
 *
 * CE QUE CELA NE CHANGE PAS. Caméra à l'origine du monde, `viewRelative` est `view` au bit près et
 * les plans relatifs sont les plans : les images déjà rendues gardent exactement leurs pixels.
 */
export interface RenderOriginFrame {
  /** La vue privée de sa translation : l'orientation de la caméra, posée à l'origine du repère. */
  viewRelative: Float64Array;
  /** Projection × vue relative. */
  viewProjectionRelative: Float64Array;
  /** Les six plans du tronc de `viewProjectionRelative`, rangés comme `frustumPlanesFromMatrix`. */
  planesRelative: Float64Array;
}

export function createRenderOriginFrame(): RenderOriginFrame {
  return {
    viewRelative: new Float64Array(16),
    viewProjectionRelative: new Float64Array(16),
    planesRelative: new Float64Array(FRUSTUM_PLANE_VALUES),
  };
}

/**
 * Réécrit les trois matrices depuis la vue et la projection absolues de l'image. `planesZeroToOne`
 * est la convention de profondeur du consommateur, comme pour les plans absolus.
 */
export function updateRenderOriginFrame(
  frame: RenderOriginFrame,
  view: ArrayLike<number>,
  projection: ArrayLike<number>,
  planesZeroToOne: boolean,
) {
  viewToRenderOrigin(frame.viewRelative, view);
  multiplyMatrix4(frame.viewProjectionRelative, projection, frame.viewRelative);
  frustumPlanesFromMatrix(frame.planesRelative, frame.viewProjectionRelative, planesZeroToOne);
  return frame;
}

/**
 * Vrai quand deux origines de repère de rendu sont le même point, au bit près. Une origine jamais
 * posée — trois `NaN` — est différente de tout, y compris d'elle-même : la première image rebase.
 */
export function sameRenderOrigin(a: ArrayLike<number>, b: ArrayLike<number>) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Recopie les trois matrices d'une caméra du moteur dans une autre, sans rien recalculer. */
export function holdRenderOriginFrame(into: RenderOriginFrame, from: RenderOriginFrame) {
  into.viewRelative.set(from.viewRelative);
  into.viewProjectionRelative.set(from.viewProjectionRelative);
  into.planesRelative.set(from.planesRelative);
  return into;
}
