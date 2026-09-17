// Les pages du banc H2b. Elles sortent de l'encodeur de référence `packages/page-codec`, celui-là
// même qui sert d'oracle au décodeur JavaScript : ce que le banc compare est donc bien deux
// lectures d'une page réelle, pas deux lectures d'un tampon fabriqué pour l'occasion.
import * as meshoptimizer from 'meshoptimizer';
import { encodeGeometryPage } from '../../page-codec/geometryPage.mjs';
import { graine } from '../../sdk-core/bench/mesure.mjs';

const STRIDE = 72;
const alea = graine(20260915);

/** Des flottants finis mais hostiles : zéro signé, dénormaux, extrêmes, et du bruit entre les deux. */
function hostiles(n) {
  const sortie = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tirage = Math.floor(alea() * 8);
    if (tirage === 0) sortie[i] = 0;
    else if (tirage === 1) sortie[i] = -0;
    else if (tirage === 2) sortie[i] = 1.175494e-38;
    else if (tirage === 3) sortie[i] = -7e-45;
    else if (tirage === 4) sortie[i] = 3.4028234e38;
    else if (tirage === 5) sortie[i] = -3.4028234e38;
    else sortie[i] = (alea() - 0.5) * 2048;
  }
  return sortie;
}

const LARGEURS = [
  ['NORMAL', 3],
  ['TEXCOORD_0', 2],
  ['TANGENT', 4],
  ['TEXCOORD_1', 2],
  ['COLOR_0', 3],
];

/** Une page de `sommets` sommets, avec ou sans ses cinq attributs facultatifs. */
export async function page(sommets, tousLesAttributs) {
  const attributes = { POSITION: { itemSize: 3, array: hostiles(sommets * 3) } };
  if (tousLesAttributs)
    for (const [nom, largeur] of LARGEURS)
      attributes[nom] = { itemSize: largeur, array: hostiles(sommets * largeur) };
  const indices = new Uint32Array(sommets * 3);
  for (let i = 0; i < sommets; i++) {
    indices[i * 3] = i;
    indices[i * 3 + 1] = (i + 1) % sommets;
    indices[i * 3 + 2] = (i + 2) % sommets;
  }
  const { data } = await encodeGeometryPage(indices, attributes);
  return data;
}
