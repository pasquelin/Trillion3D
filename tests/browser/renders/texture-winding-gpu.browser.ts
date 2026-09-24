// Defects 4 and 7, GPU: production WGSL (`wrapUv`/`wrapCoord`, packages/sdk-browser/src/visibility/wrapModes.ts)
// sampled by a real WebGPU GPU in Chromium, against the native sampler set to the same
// addressing mode — all on a texture of distinct texels, in linear filtering. Two series:
//   • off a period seam, mirror, repeat and clamp stay identical bit for bit;
//   • on a period seam in repeat, the engine itself blends the two texture edges; its
//     weight cannot equal bit for bit the one the sampler quantises, so the rendered
//     colour is compared to the exact rule, to half a level in 255.
// `addressingGpuPage.ts` (tests/browser/probes) holds the WebGPU orchestration and the tap shader,
// already checked by the lot's reproduction; this test writes its own cases, structured differently
// from the reproduction's so it stays an independent proof. The shader itself is not copied:
// two copies would be two chances for the probed read to drift from production.
//
//   node --experimental-strip-types tests/browser/renders/texture-winding-gpu.browser.ts
import { importHostTexture } from '../../../packages/sdk-browser/src/host/textureImport.ts';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { wrapNibble } from '../../../packages/sdk-browser/src/visibility/wrapModes.ts';
import {
  MODES_GPU,
  octetsTexture,
  regleNormalisee,
  surCouture,
  TOLERANCE,
} from '../probes/addressingCases.ts';
import { executerDansChromium, MELANGE, NUANCEUR_PRISES } from '../probes/addressingGpuPage.ts';

// A 4×3 texture, every texel distinct (red = 20+40x, green = 20+40y, alpha = 10+10·rank).
const LARGEUR = 4,
  HAUTEUR = 3;
const texture = {
  largeur: LARGEUR,
  hauteur: HAUTEUR,
  octets: Array.from(octetsTexture(LARGEUR, HAUTEUR)),
};

// UVs off an exact boundary (linear filtering has no rounding ambiguity there): negative,
// near an integer, half-texel, large (±1e3) — including u = 1.25 on 4 texels, the value kept
// as the lot's reference (texel 2 in mirror). None lands in a border's half-texel.
const UV = [-1000.375, -2.375, -0.625, 0.375, 0.625, 1.25, 2.625, 1000.625].flatMap((t) => [
  [t, 0.625],
  [0.375, t],
]);

// The half-texel of a period's two edges, on one axis then the other then both: that is
// where the rule blends the last texel and the first, and wrapping the coordinate splits them.
const COUTURES = [0, 0.02, 0.999, -0.01, -3, 1000.04, 2.98].flatMap((t) => [
  [t, 0.625],
  [0.375, t],
  [t, t],
]);

const lots = [UV, COUTURES].flatMap((uv) =>
  MODES_GPU.map(({ wrap, adresse }) => {
    assert.ok(adresse, `no WebGPU address mode for wrap ${wrap}`);
    // A real host texture, imported: `wrapNibble` reads the engine's own record.
    const host = new G.GraphTexture();
    host.wrapS = wrap;
    host.wrapT = wrap;
    const map = importHostTexture(host);
    return {
      filtre: 'linear' as const,
      texture: 0,
      adresseS: adresse,
      adresseT: adresse,
      uv: uv.flat(),
      // `MELANGE` asks the tap shader for the full read: this bench only probes linear
      // filtering, including the blend of the four taps on a period seam.
      flags: uv.map(() => wrapNibble(map) | MELANGE),
    };
  }),
);

const sorties = await executerDansChromium({
  shader: NUANCEUR_PRISES,
  textures: [texture],
  lots,
});

/** The rule's exact colour on component `k`'s axis, the two texels blended. */
const regle = (uv: number[], wrap: THREE.Wrapping, k: number) =>
  regleNormalisee(uv[k], k ? HAUTEUR : LARGEUR, wrap);

let ecarts = 0,
  couturesEprouvees = 0;
lots.forEach(({ uv: plat }, rang) => {
  const { nom, wrap } = MODES_GPU[rang % MODES_GPU.length];
  const { moteur, three } = sorties[rang];
  for (let i = 0; i < plat.length / 2; i++) {
    const uv = [plat[i * 2], plat[i * 2 + 1]];
    for (let k = 0; k < 2; k++) {
      const couture = surCouture(uv[k], k ? HAUTEUR : LARGEUR, wrap);
      const a = moteur[i * 4 + k];
      if (!couture) {
        if (Object.is(a, three[i * 4 + k])) continue;
        ecarts++;
        console.error(`${nom} uv=(${uv}) component ${k}: engine=${a} sampler=${three[i * 4 + k]}`);
        continue;
      }
      couturesEprouvees++;
      const attendu = regle(uv, wrap, k);
      if (Math.abs(a - attendu) * 255 <= TOLERANCE) continue;
      ecarts++;
      console.error(`${nom} uv=(${uv}) component ${k}: engine=${a * 255} rule=${attendu * 255}`);
    }
  }
});

assert.equal(ecarts, 0, `${ecarts} mismatches between the engine WGSL and the sampler rule`);
assert.ok(couturesEprouvees > 0, 'no period seam probed');
console.log(
  `GPU wrap mirror/repeat/clamp: 0 mismatch on ${lots.length} lots,` +
    ` of which ${couturesEprouvees} components on a period seam, linear filtering.`,
);
