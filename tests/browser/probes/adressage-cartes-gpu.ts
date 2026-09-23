// Defect 8, GPU side: a material whose maps do not share the same wrap mode.
// The page row is written by the real `createPageRowWriter`, and the wrap word the shader gives
// each map is reread by `wrapOf`, the CPU mirror of the WGSL `wrapOf`. Each map is then sampled
// by the engine's wrap WGSL, in Chromium, and compared to the native sampler set to that map's
// mode — the reference of batches 4 and 7.
//   node --experimental-strip-types \
//     tests/browser/probes/adressage-cartes-gpu.ts
// Blocking: any bit-for-bit discrepancy off a period seam, and on the seam any read that
// departs from the exact rule by more than half a level in 255.
import type * as THREE from 'three';
import { wrapOf } from '../../../packages/sdk-browser/src/visibility/wrapModes.ts';
import { ROW_WRAP_MODES_WORD } from '../../../packages/sdk-browser/src/webgpu/row/pageRow.ts';
import { ADRESSE, regleNormalisee, surCouture, TOLERANCE } from './adressageCas.ts';
import { executerDansChromium, MELANGE, NUANCEUR_PRISES } from './adressageGpuPage.ts';
import { CARTES, ligneDePageMelangee, TEXTURE, UV } from './adressageCartes.ts';

const { ints } = ligneDePageMelangee();
// Every wrapS/wrapT of `CARTES` is one of the three modes `ADRESSE` maps, so the lookup is never
// absent: only its declared type is loose (`Map.get` always returns `V | undefined`).
const lots = CARTES.map(({ carte, wrapS, wrapT }) => ({
  filtre: 'linear' as const,
  texture: 0,
  adresseS: ADRESSE.get(wrapS)!,
  adresseT: ADRESSE.get(wrapT)!,
  uv: UV.flat(),
  flags: UV.map(() => wrapOf(ints[ROW_WRAP_MODES_WORD], carte) | MELANGE),
}));

const sorties = await executerDansChromium({
  shader: NUANCEUR_PRISES,
  textures: [TEXTURE],
  lots,
});

/** The rule's exact colour on component `k`'s axis, the two texels blended. */
const regle = (uv: number[], wrap: THREE.Wrapping, k: number) =>
  regleNormalisee(uv[k], k ? TEXTURE.hauteur : TEXTURE.largeur, wrap);

let bloquants = 0,
  couturesEprouvees = 0;
console.log('\nDefect 8: one map per mode, read by the engine wrap WGSL');
CARTES.forEach(({ nom, wrapS, wrapT }, rang) => {
  const { moteur, three } = sorties[rang];
  let ecarts = 0,
    pire = 0,
    exemple: string | null = null;
  UV.forEach((uv, i) => {
    for (let k = 0; k < 2; k++) {
      const wrap = k ? wrapT : wrapS,
        taille = k ? TEXTURE.hauteur : TEXTURE.largeur;
      const lu = moteur[i * 4 + k];
      if (!surCouture(uv[k], taille, wrap)) {
        if (Object.is(lu, three[i * 4 + k])) continue;
        ecarts++;
        pire = Math.max(pire, Math.abs(lu - three[i * 4 + k]) * 255);
        exemple ??= `uv=(${uv}) component ${k}: engine=${lu * 255} map=${three[i * 4 + k] * 255}`;
        continue;
      }
      couturesEprouvees++;
      const attendu = regle(uv, wrap, k);
      if (Math.abs(lu - attendu) * 255 <= TOLERANCE) continue;
      ecarts++;
      pire = Math.max(pire, Math.abs(lu - attendu) * 255);
      exemple ??= `uv=(${uv}) component ${k}: engine=${lu * 255} rule=${attendu * 255}`;
    }
  });
  bloquants += ecarts;
  const modes = `${ADRESSE.get(wrapS)}/${ADRESSE.get(wrapT)}`;
  console.log(
    `  ${nom.padEnd(10)} ${modes.padEnd(28)} ${String(ecarts).padStart(3)} discrepancies / ${UV.length * 2}` +
      `${ecarts ? `  worst ${pire.toFixed(2)}/255  e.g. ${exemple}` : ''}`,
  );
});
console.log(`\n${couturesEprouvees} components exercised on a period seam`);
console.log(`GPU, one map per mode: ${bloquants} blocking discrepancies`);
process.exitCode = bloquants ? 1 : 0;
