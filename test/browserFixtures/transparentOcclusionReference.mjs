// La réfutation, grappe par grappe, des rejets du test d'occultation des transparents.
//
// La référence n'est pas transcrite : c'est le code de production lui-même — `projectCornersInto`
// (hizCorners.ts) en double précision, `hizNearestBound` (hizNearestBound.ts) pour le redressement
// et le biais de couche, `buildHizPyramid` puis `hizRejectsFlat` (hizDepth.ts, hizOcclusion.ts)
// pour le dépouillement. La profondeur dépouillée est celle que la carte a réellement laissée à la
// fin de la passe opaque, relue pleine résolution.
//
// Ce qui est vérifié, pour CHAQUE grappe transparente que la carte a retirée : la référence, sur
// ses propres bornes — plus serrées que celles de la carte —, la rejette elle aussi. Autrement dit
// `nearest < far − biais` tient encore quand on refuse tout à la carte : sa marge d'erreur, son
// rectangle élargi et son mip plus grossier. Zéro violation est la seule valeur acceptable.
import { HIZ_BOUNDS_VALUES, projectCornersInto } from '../../packages/sdk-browser/hizCorners.ts';
import { hizNearestBound } from '../../packages/sdk-browser/hizNearestBound.ts';
import { buildHizPyramid } from '../../packages/sdk-browser/hizDepth.ts';
import { hizRejectsFlat } from '../../packages/sdk-browser/hizOcclusion.ts';

const scratch = new Float64Array(HIZ_BOUNDS_VALUES);
/** Doubles d'une boîte monde dans la disposition de `createBoxCorners`. */
const BOX_CORNER_VALUES = 24;

export function emptyOcclusionTotals() {
  return { rejetees: 0, examinees: 0, violations: 0, coupesReference: 0, horsEcran: 0, poses: 0 };
}

/**
 * Vérifie l'audit d'une image et accumule dans `total`. La pyramide de référence est bâtie une fois
 * par pose, depuis la profondeur relue, et sert à toutes les grappes de cette pose.
 */
export function checkOcclusionAudit(audit, total) {
  // Une seule convention de profondeur traverse le moteur (`depthConvention.ts`) : la référence et
  // le noyau lisent la même vue-projection, donc leurs bornes se comparent directement.
  const pyramid = buildHizPyramid(audit.depth, audit.width, audit.height);
  total.poses++;
  total.examinees += audit.examined;
  const violations = [];
  for (let i = 0; i < audit.rejected.length; i++) {
    total.rejetees++;
    projectCornersInto(
      audit.corners,
      i * BOX_CORNER_VALUES,
      audit.view,
      audit.viewProj,
      audit.near,
      audit.width,
      audit.height,
      scratch,
      0,
    );
    // Une boîte que la référence dit coupée par le plan proche ne doit jamais avoir été rejetée.
    if (scratch[5] !== 0) {
      total.coupesReference++;
      total.violations++;
      if (violations.length < 5) violations.push({ entree: audit.rejected[i], cause: 'coupe' });
      continue;
    }
    // Le rectangle de RÉFÉRENCE contient déjà l'empreinte vraie de la grappe : s'il ne rencontre
    // pas le viewport, la grappe ne peut poser aucun pixel et la retirer est sans effet sur
    // l'image. La référence, elle, refuse de trancher dans ce cas — elle ne rejette jamais une
    // boîte hors écran —, si bien que la comparaison n'a pas lieu d'être.
    if (
      Math.max(scratch[0], 0) > Math.min(scratch[2], audit.width - 1) ||
      Math.max(scratch[1], 0) > Math.min(scratch[3], audit.height - 1)
    ) {
      total.horsEcran++;
      continue;
    }
    scratch[4] = hizNearestBound(scratch[4], audit.layer);
    if (!hizRejectsFlat(pyramid, scratch, 0)) {
      total.violations++;
      if (violations.length < 5)
        violations.push({
          entree: audit.rejected[i],
          cause: 'visible pour la référence',
          nearest: scratch[4],
          rect: [scratch[0], scratch[1], scratch[2], scratch[3]],
        });
    }
  }
  return violations;
}
