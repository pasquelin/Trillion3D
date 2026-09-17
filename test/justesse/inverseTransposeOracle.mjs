// L'ORACLE D'ORIENTATION VRAIE des cas du défaut 6 : non pas un modèle de ce que le moteur devrait
// dessiner, mais ce qu'il dessine — les cas rasterisés dans Chromium WebGPU avec l'état de face du
// moteur (`cullMode:'back'` et le `frontFace` que `windingCw` inverse sous réflexion, comme Three en
// WebGL), un compteur de fragments par cas. `noyauRasterGpu.mjs` pour la rasterisation,
// `reflexionCas.mjs` pour la charge.
//
// Pourquoi il faut celui-là et pas `veriteTerrain` : l'orientation géométrique brute des sommets
// transformés (`cross(e1,e2)` contre la caméra) ignore que le moteur échange la face éliminée quand
// le déterminant est négatif. Sur une réflexion, elle dit « de face » la face que le moteur ne
// dessine pas. Un cluster supprimé par la coupe n'est donc un DÉFAUT que si le moteur, lui, en
// dessinait des fragments ; sinon la suppression est correcte. Les deux populations vivaient
// jusqu'ici sous le même mot « suppression » et sous le même compte.
import assert from 'node:assert/strict';
import { rasterGpu } from './noyauRasterGpu.mjs';
import { chargeRaster } from './reflexionCas.mjs';

/** Pour chaque cas : le moteur en dessine-t-il au moins un fragment ? Plus l'adaptateur employé. */
export async function dessineParLeMoteur(cas) {
  const gpu = await rasterGpu(chargeRaster(cas));
  assert.equal(gpu.indisponible ?? null, null, `GPU indisponible : ${gpu.indisponible}`);
  assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], [], 'WGSL');
  return {
    adaptateur: gpu.adaptateur,
    fragments: gpu.fragments,
    dessine: cas.map((_, i) => gpu.fragments[i] > 0),
  };
}

/**
 * Le classement des rejets de coupe contre l'oracle ci-dessus. Le compte d'autrefois — « la vérité
 * brute dit de face et la coupe rejette » — n'est pas remplacé en silence : il est gardé sous
 * `brutes` et ouvert en deux, et ce que la vérité brute NE voyait PAS est compté à côté.
 *   — `fausses` : la coupe rejette un cluster dont le moteur dessine des fragments. LE défaut.
 *   — `brutesDessinees` : la part de l'ancien compte qui était bien un défaut.
 *   — `brutesNonDessinees` : la part qui n'en était pas un — le moteur n'en dessine rien.
 *   — `manqueesParLaVeriteBrute` : les défauts que l'ancien compte ne voyait pas du tout, parce
 *     que la vérité brute les dit de dos alors que le moteur les dessine (l'échange de face sous
 *     réflexion joue dans les deux sens).
 * Invariants : `brutes = brutesDessinees + brutesNonDessinees` et
 * `fausses = brutesDessinees + manqueesParLaVeriteBrute`.
 */
export function classement({ cas, verites, moteur }) {
  const index = cas.map((_, i) => i);
  const brute = (i) => verites[i].avantVisible;
  const dessine = (i) => moteur.dessine[i];
  const fausses = (rejets) => index.filter((i) => rejets[i] && dessine(i));
  const compte = (rejets, predicat) => index.filter((i) => rejets[i] && predicat(i)).length;
  const population = (rejets) => ({
    brutes: compte(rejets, brute),
    fausses: fausses(rejets).length,
    brutesDessinees: compte(rejets, (i) => brute(i) && dessine(i)),
    brutesNonDessinees: compte(rejets, (i) => brute(i) && !dessine(i)),
    manqueesParLaVeriteBrute: compte(rejets, (i) => !brute(i) && dessine(i)),
    miroirs: compte(rejets, (i) => brute(i) && cas[i].miroir),
  });
  return { index, fausses, population };
}
