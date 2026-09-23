// Defect 4, CPU side: the real `wrapTexel`, the real `sampleLinear` read and the real
// visibility raster (alpha test) against Three's rule, on every `adressageCas` case.
// Defect 7: `wrapLinear`, the CPU mirror of the shader addressing rule, against the
// whole sampler rule in linear filtering — including a period seam.
// Defect 8: a material whose six maps do not share the same mode. The CPU path reads
// the mode in the texture it samples (`texelAt`), not in a material flag: it is
// counted map by map rather than deduced from reading the code.
//   node --experimental-strip-types tests/browser/probes/addressing-cpu.ts [sortie.json]
// Exit code 1 on the first mismatch. `sortie.json` receives the texels read, to compare two commits.
import {
  importHostTexture,
  importWrapMode,
} from '../../../packages/sdk-browser/src/host/surfaceImport.ts';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { sampleLinear, wrapTexel } from '../../../packages/sdk-browser/src/visibility/math.ts';
import { wrapLinear } from '../../../packages/sdk-browser/src/visibility/wrapModes.ts';
import { rasterVisibility } from '../../../packages/sdk-browser/src/visibility/raster.ts';
import { cas, lineaireThree, melange, octetsTexture, texelThree } from './addressingCases.ts';
import type { AdressageCas } from './addressingCases.ts';
import { bilan, somme } from './addressingSummary.ts';
import { CARTES, materielMelange, TEXTURE, UV } from './addressingMaps.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import { surfaceOf } from '../../../packages/sdk-browser/src/page/surface.ts';

const textures = new Map<string, THREE.Texture>();
function carte(c: AdressageCas) {
  const cle = `${c.largeur}x${c.hauteur}/${c.wrapS}/${c.wrapT}`;
  if (!textures.has(cle)) {
    const map = new THREE.Texture();
    map.image = { data: octetsTexture(c.largeur, c.hauteur), width: c.largeur, height: c.hauteur };
    map.wrapS = c.wrapS;
    map.wrapT = c.wrapT;
    map.flipY = false;
    textures.set(cle, map);
  }
  return textures.get(cle)!;
}

/**
 * The texel the raster keeps: a triangle whose vertex `a` lands exactly on pixel
 * (0, 0), where weights are (1, 0, 0), carries the case coordinate as-is. A texel's
 * alpha is 10 + 10·rank; bisection on `alphaTest` recovers the rank of the texel read.
 */
const camera = new THREE.PerspectiveCamera();
camera.projectionMatrix.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0.5, 0, 0, -1, 0);
const positions = new THREE.Float32BufferAttribute([-1, 1, -1, 3, 1, -1, -1, -3, -1], 3);
function texelRaster(c: AdressageCas): [number, number] | null {
  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute('position', positions);
  geometrie.setAttribute('uv', new THREE.Float32BufferAttribute([c.u, c.v, c.u, c.v, c.u, c.v], 2));
  const materiau = new THREE.MeshBasicMaterial({ map: carte(c), side: THREE.DoubleSide });
  const page = {
    array: new Uint32Array([0, 1, 2]),
    attributes: geometrie.attributes,
    matrix: new THREE.Matrix4(),
    material: surfaceOf(materiau),
  };
  const garde = (rang: number) => {
    materiau.alphaTest = (10 + 10 * rang) / 255;
    return rasterVisibility([page], cameraMoteur(camera), [1, 1]).ids[0] !== 0;
  };
  if (!garde(0)) return null;
  let bas = 0,
    haut = c.largeur * c.hauteur - 1;
  while (bas < haut) {
    const milieu = (bas + haut + 1) >> 1;
    if (garde(milieu)) bas = milieu;
    else haut = milieu - 1;
  }
  return [bas % c.largeur, Math.floor(bas / c.largeur)];
}

const tous = cas();
const lus = tous.map((c, rang) => {
  c.rang = rang;
  const [r, g] = sampleLinear(importHostTexture(carte(c)), c.u, c.v);
  return {
    wrapTexel: [
      wrapTexel(c.u, c.largeur, importWrapMode(c.wrapS)),
      wrapTexel(c.v, c.hauteur, importWrapMode(c.wrapT)),
    ],
    sampleLinear: [Math.round((r * 255 - 20) / 40), Math.round((g * 255 - 20) / 40)],
    raster: texelRaster(c),
  };
});
type Chemin = 'wrapTexel' | 'sampleLinear' | 'raster';
const ecart = (chemin: Chemin) => (c: AdressageCas, k: number) => {
  // `cas()` is walked in order right above and every element's `rang` set there: by the time
  // `ecart` runs, it is never undefined.
  const lu = lus[c.rang!][chemin];
  return lu && lu[k] === c.attendu[k]
    ? null
    : `${c.largeur}x${c.hauteur} S=${c.nomS} T=${c.nomT} uv=(${c.u}, ${c.v}) Three=${c.attendu} got=${lu}`;
};
let ecarts = 0;
for (const chemin of ['wrapTexel', 'sampleLinear', 'raster'] as const)
  ecarts += somme(bilan(`CPU ${chemin} against Three (${tous.length} cases)`, tous, ecart(chemin)));

/**
 * Defect 7: the colour linear filtering must render on the probed axis, the rule's two
 * texels blended in double precision, against those `wrapLinear` designates. Both calculations
 * start from the same 32-bit coordinate, so their agreement is exact, not approximate.
 */
const lineaire = (c: AdressageCas, k: number) => {
  const t = k ? c.v : c.u,
    taille = k ? c.hauteur : c.largeur,
    wrap = k ? c.wrapT : c.wrapS;
  const lu = melange(wrapLinear(t, taille, importWrapMode(wrap))),
    attendu = melange(lineaireThree(t, taille, wrap));
  return Math.abs(lu - attendu) <= 1e-9
    ? null
    : `${c.largeur}x${c.hauteur} S=${c.nomS} T=${c.nomT} uv=(${c.u}, ${c.v}) rule=${attendu} got=${lu}`;
};
ecarts += somme(
  bilan(`CPU wrapLinear against the sampler rule (${tous.length} cases)`, tous, lineaire),
);

/**
 * Defect 8, CPU: each map of the mixed material, read by the real `sampleLinear`, against the
 * rule texel in that map's own mode. Zero mismatch expected on either side of the lot:
 * the defect only exists on the GPU path, where the addressing word travelled separately.
 */
const materiau = materielMelange();
const image = {
  data: octetsTexture(TEXTURE.largeur, TEXTURE.hauteur),
  width: TEXTURE.largeur,
  height: TEXTURE.hauteur,
};
console.log('\nDefect 8: each map of the mixed material, read by sampleLinear (CPU)');
for (const { nom, champ, wrapS, wrapT } of CARTES) {
  // `materielMelange` assigns a real Texture to every slot of `CARTES`: never null here.
  const map = Object.assign(materiau[champ]!, { image, flipY: false });
  let ecartsCarte = 0;
  for (const [u, v] of UV) {
    const [r, g] = sampleLinear(importHostTexture(map), u, v);
    const lu = [Math.round((r * 255 - 20) / 40), Math.round((g * 255 - 20) / 40)];
    const attendu = [texelThree(u, TEXTURE.largeur, wrapS), texelThree(v, TEXTURE.hauteur, wrapT)];
    if (lu[0] !== attendu[0] || lu[1] !== attendu[1]) ecartsCarte++;
  }
  ecarts += ecartsCarte;
  console.log(`  ${nom.padEnd(10)} ${String(ecartsCarte).padStart(3)} mismatches / ${UV.length}`);
}

/** For the record: `Texture.transformUv`, Three's CPU rule, contradicts its own
 *  GPU on boundaries; it is not the reference, we only count. */
const transformUv = (c: AdressageCas, k: number) => {
  const uv = carte(c).transformUv(new THREE.Vector2(c.u, c.v));
  const lu = [
    Math.min(c.largeur - 1, Math.floor(uv.x * c.largeur)),
    Math.min(c.hauteur - 1, Math.floor(uv.y * c.hauteur)),
  ];
  return lu[k] === c.attendu[k] ? null : `${c.nomS}/${c.nomT} uv=(${c.u}, ${c.v}) got=${lu}`;
};
bilan('For the record, Texture.transformUv against the GPU', tous, transformUv);

if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(lus));
console.log(`\nCPU: ${ecarts} mismatches on ${tous.length * 8} components read`);
process.exitCode = ecarts ? 1 : 0;
