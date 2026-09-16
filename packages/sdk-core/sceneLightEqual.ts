import type { SceneEnvironment, SceneLight } from './sceneLightContracts.ts';

/** Deux vecteurs optionnels du contrat : absents tous les deux, ou identiques composante à composante. */
function sameVector(a: readonly number[] | undefined, b: readonly number[] | undefined) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Vrai quand deux lampes validées décrivent exactement la même lumière — tableaux compris.
 *
 * Une mutation qui repose les valeurs déjà tenues ne change rien à l'image : republier sa révision
 * et l'époque du magasin ferait repartir les pages d'ombre de cette lampe et refuserait l'image
 * tenue, pour un résultat identique au pixel près. Un hôte qui renvoie ses lampes fixes à chaque
 * image — le cas courant — paierait ainsi une invalidation par image et par lampe.
 *
 * L'identifiant n'est pas comparé : les deux lampes sont celles d'un même emplacement.
 */
export function sameSceneLight(a: SceneLight, b: SceneLight) {
  return (
    a.kind === b.kind &&
    a.intensity === b.intensity &&
    a.castsShadow === b.castsShadow &&
    a.range === b.range &&
    a.coneAngle === b.coneAngle &&
    a.emitterRadius === b.emitterRadius &&
    sameVector(a.color, b.color) &&
    sameVector(a.position, b.position) &&
    sameVector(a.direction, b.direction)
  );
}

/** Même règle pour l'environnement : une exposition reposée à l'identique ne périme aucune image. */
export function sameSceneEnvironment(a: SceneEnvironment, b: SceneEnvironment) {
  return a.exposure === b.exposure;
}
