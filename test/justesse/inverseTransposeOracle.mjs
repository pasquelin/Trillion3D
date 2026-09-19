// TRUE ORIENTATION ORACLE of defect 6's cases: not a model of what the engine should draw, but
// what it draws — the cases rasterised in Chromium WebGPU with the engine's face state
// (`cullMode:'back'` and the `frontFace` that `windingCw` flips under reflection, as Three does on
// WebGL), one fragment counter per case. `noyauRasterGpu.mjs` for rasterisation,
// `reflexionCas.mjs` for the payload.
//
// Why this one and not `veriteTerrain`: the raw geometric orientation of transformed vertices
// (`cross(e1,e2)` against the camera) ignores that the engine swaps the culled face when the
// determinant is negative. On a reflection, it says "face-on" of the face the engine does not
// draw. A cluster dropped by the cut is therefore a DEFECT only if the engine itself drew
// fragments of it; otherwise the drop is correct. The two populations lived until now under the
// same word "drop" and the same count.
import assert from 'node:assert/strict';
import { rasterGpu } from './noyauRasterGpu.mjs';
import { chargeRaster } from './reflexionCas.mjs';

/** For each case: does the engine draw at least one fragment of it? Plus the adapter used. */
export async function dessineParLeMoteur(cas) {
  const gpu = await rasterGpu(chargeRaster(cas));
  assert.equal(gpu.indisponible ?? null, null, `GPU unavailable: ${gpu.indisponible}`);
  assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], [], 'WGSL');
  return {
    adaptateur: gpu.adaptateur,
    fragments: gpu.fragments,
    dessine: cas.map((_, i) => gpu.fragments[i] > 0),
  };
}

/**
 * Classification of cut rejects against the oracle above. The old count — "raw truth says
 * face-on and the cut rejects" — is not silently replaced: it is kept under `brutes` and split
 * in two, and what the raw truth did NOT see is counted beside it.
 *   — `fausses`: the cut rejects a cluster whose engine draws fragments. THE defect.
 *   — `brutesDessinees`: the part of the old count that was indeed a defect.
 *   — `brutesNonDessinees`: the part that was not — the engine draws nothing of it.
 *   — `manqueesParLaVeriteBrute`: defects the old count did not see at all, because raw truth
 *     says they are back-facing while the engine draws them (face swap under reflection plays
 *     both ways).
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
