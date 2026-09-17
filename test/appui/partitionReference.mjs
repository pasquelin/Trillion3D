// La comparaison de l'audit à la RÉFÉRENCE, cluster par cluster.
//
// La référence n'est pas transcrite : c'est le code de production lui-même, `projectCornersInto`
// (hizCorners.ts) suivi de `hizNearestBound` (hizNearestBound.ts) — l'arithmétique en double
// précision que le processeur faisait par ligne avant que la partition ne passe sur la carte, et
// que la coupe processeur et les oracles font encore. Le module de page est empaqueté depuis les
// sources du dépôt, si bien que la preuve lit exactement ce que le moteur lit.
//
// Ce que la comparaison vérifie :
//   1. le rectangle de la carte CONTIENT celui de la référence (chaque borne est au moins aussi
//      large, jamais plus étroite d'un texel) ;
//   2. une boîte que la référence dit coupée par le plan proche porte le drapeau de coupe côté
//      carte, donc ne peut jamais être rejetée ;
//   3. la profondeur de la carte MINORE celle de la référence, biais de couche coplanaire compris.
import { HIZ_BOUNDS_VALUES, projectCornersInto } from '../../packages/sdk-browser/hizCorners.ts';
import { hizNearestBound } from '../../packages/sdk-browser/hizNearestBound.ts';

const scratch = new Float64Array(HIZ_BOUNDS_VALUES);

/** Compare l'audit d'une image à la référence, ligne par ligne, et accumule dans `total`. */
export function compareAudit(audit, total) {
  const { rows, view, viewProj, near, width, height, corners, layers } = audit;
  for (let row = 0; row < rows; row++) {
    // Une seule convention de profondeur (`depthConvention.ts`) : la référence lit la même
    // vue-projection que le noyau, et sa borne se compare directement à celle qu'il a écrite.
    projectCornersInto(corners, row * 24, view, viewProj, near, width, height, scratch, 0);
    total.clusters++;
    if (scratch[5] !== 0) {
      total.coupes++;
      // Règle 2 : une boîte que la référence dit coupée doit porter le drapeau côté carte.
      if (!audit.clips[row]) total.violations2++;
      continue;
    }
    // Une boîte que la carte dit coupée alors que la référence ne le dit pas n'est jamais rejetée :
    // c'est plus conservateur, jamais moins. On la compte, on ne la compare pas.
    if (audit.clips[row]) {
      total.coupesGpuSeules++;
      continue;
    }
    total.compares++;
    const rx0 = scratch[0],
      ry0 = scratch[1],
      rx1 = scratch[2],
      ry1 = scratch[3];
    const gx0 = audit.rect[row * 4],
      gy0 = audit.rect[row * 4 + 1],
      gx1 = audit.rect[row * 4 + 2],
      gy1 = audit.rect[row * 4 + 3];
    // Règle 1 : contenance. La marge est ce que la carte a ajouté de chaque côté, en texels.
    for (const marge of [rx0 - gx0, ry0 - gy0, gx1 - rx1, gy1 - ry1]) {
      if (marge < 0) total.violations1++;
      total.margeTexelsSomme += marge;
      if (marge > total.margeTexelsMax) total.margeTexelsMax = marge;
      total.margeTexelsCount++;
      // La moyenne d'une marge est écrasée par quelques boîtes rasantes : ce qui décrit vraiment la
      // perte de finesse du test est la répartition — combien de côtés n'ont pas bougé d'un texel.
      total.margeParPalier[
        marge <= 0 ? 0 : marge <= 1 ? 1 : marge <= 4 ? 2 : marge <= 16 ? 3 : 4
      ]++;
    }
    // La largeur du rectangle, comparée au noyau de seize texels du test : au-delà, la boîte répond
    // depuis un mip plus grossier et rejette moins. Les deux répartitions doivent se ressembler.
    const palier = (w) => (w < 16 ? 0 : w < 64 ? 1 : w < 256 ? 2 : 3);
    total.largeurParPalier[palier(Math.max(gx1 - gx0, gy1 - gy0))]++;
    total.largeurRefParPalier[palier(Math.max(rx1 - rx0, ry1 - ry0))]++;
    // Règle 3 : majoration. La profondeur est inversée, donc une borne sûre MAJORE ce que le
    // cluster écrira : l'écart est ce que la carte a monté au-dessus de la référence.
    const ecart = audit.nearest[row] - hizNearestBound(scratch[4], layers[row]);
    if (ecart < 0) total.violations3++;
    total.ecartProfondeurSomme += ecart;
    if (ecart > total.ecartProfondeurMax) total.ecartProfondeurMax = ecart;
  }
}

export function emptyTotals() {
  return {
    clusters: 0,
    compares: 0,
    coupes: 0,
    coupesGpuSeules: 0,
    violations1: 0,
    violations2: 0,
    violations3: 0,
    margeTexelsSomme: 0,
    margeTexelsMax: 0,
    margeTexelsCount: 0,
    /** Côtés de rectangle par palier de marge : 0, ≤ 1, ≤ 4, ≤ 16, au-delà. */
    margeParPalier: [0, 0, 0, 0, 0],
    /** Boîtes par palier de largeur écran, carte puis référence : < 16, < 64, < 256, au-delà. */
    largeurParPalier: [0, 0, 0, 0],
    largeurRefParPalier: [0, 0, 0, 0],
    ecartProfondeurSomme: 0,
    ecartProfondeurMax: 0,
  };
}
