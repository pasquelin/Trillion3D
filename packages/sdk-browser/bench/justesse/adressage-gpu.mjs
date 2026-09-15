// Défaut 4, côté carte graphique : le WGSL d'adressage du moteur exécuté dans Chromium WebGPU, sur
// une vraie texture à texels distincts, à côté du vrai échantillonneur réglé comme Three règle le
// sien (mode de la carte → `addressMode`). Deux filtrages : au plus proche (le texel choisi) et
// linéaire (le filtrage réel de l'échantillonneur du moteur, comparé bit à bit).
//   LAB_ROOT=…/render-tech-lab node --experimental-strip-types \
//     packages/sdk-browser/bench/justesse/adressage-gpu.mjs [sortie.json]
// Bloquant : tout écart au plus proche hors frontière ; tout écart linéaire en serrage et en miroir.
// Pour mémoire seulement : au plus proche sur une frontière exacte, le texel dépend de l'arrondi
// 32 bits de u·taille ; en linéaire sous Repeat, la couture d'une période lit le bord serré au lieu
// du texel de la période voisine (défaut distinct, présent avant ce lot et laissé tel quel).
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { WRAP_COORD_WGSL } from '../../visibilityPageWgsl.ts';
import { FLAG_WRAP_S_REPEAT, FLAG_WRAP_T_REPEAT } from '../../visibilityTypes.ts';
import { bilan, cas, octetsTexture, somme, TAILLES } from './adressageCas.mjs';
import { executerDansChromium } from './adressageGpuPage.mjs';

/** Les drapeaux tels que `webgpuPageRow.ts` et `webgpuBlendPrepare.ts` les écrivent. */
const drapeaux = (c) =>
  (c.wrapS !== THREE.ClampToEdgeWrapping ? FLAG_WRAP_S_REPEAT : 0) |
  (c.wrapT !== THREE.ClampToEdgeWrapping ? FLAG_WRAP_T_REPEAT : 0);
/** L'appel des passes de géométrie, d'ombrage et de mélange, au caractère près. */
const APPEL = 'vec2f(wrapCoord(c.uv.x,(c.flags&32u)!=0u),wrapCoord(c.uv.y,(c.flags&64u)!=0u))';

const SHADER = `${WRAP_COORD_WGSL}
struct Cas{uv:vec2f,flags:u32,pad:u32,}
@group(0) @binding(0) var maps:texture_2d_array<f32>;
@group(0) @binding(1) var moteur:sampler;
@group(0) @binding(2) var three:sampler;
@group(0) @binding(3) var<storage,read> lot:array<Cas>;
struct Sortie{@location(0) moteur:vec4f,@location(1) three:vec4f,}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
 let p=array(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));return vec4f(p[i],0.0,1.0);
}
@fragment fn fs(@builtin(position) q:vec4f)->Sortie{
 let c=lot[u32(q.x)];
 let wrapped=${APPEL};
 return Sortie(textureSampleLevel(maps,moteur,wrapped,0,0.0),textureSampleLevel(maps,three,c.uv,0,0.0));
}`;

const ADRESSE = new Map([
  [THREE.ClampToEdgeWrapping, 'clamp-to-edge'],
  [THREE.RepeatWrapping, 'repeat'],
  [THREE.MirroredRepeatWrapping, 'mirror-repeat'],
]);
const tous = cas();
const lots = [];
for (const filtre of ['nearest', 'linear'])
  TAILLES.forEach(([largeur, hauteur], texture) => {
    for (const [wrapS, adresseS] of ADRESSE)
      for (const [wrapT, adresseT] of ADRESSE) {
        const membres = tous.filter(
          (c) =>
            c.largeur === largeur &&
            c.hauteur === hauteur &&
            c.wrapS === wrapS &&
            c.wrapT === wrapT,
        );
        const uv = membres.flatMap((c) => [c.u, c.v]);
        lots.push({
          filtre,
          texture,
          membres,
          adresseS,
          adresseT,
          uv,
          flags: membres.map(drapeaux),
        });
      }
  });

const sorties = await executerDansChromium({
  shader: SHADER,
  textures: TAILLES.map(([largeur, hauteur]) => ({
    largeur,
    hauteur,
    octets: Array.from(octetsTexture(largeur, hauteur)),
  })),
  lots: lots.map(({ filtre, texture, adresseS, adresseT, uv, flags }) => ({
    filtre,
    texture,
    adresseS,
    adresseT,
    uv,
    flags,
  })),
});

/** Chaque cas retrouve sa ligne relue, au plus proche puis en linéaire (même ordre de lots). */
const lecture = { nearest: new Map(), linear: new Map() };
lots.forEach((lot, l) =>
  lot.membres.forEach((c, i) => lecture[lot.filtre].set(c, { ...sorties[l], i })),
);
const exemple = (c, a, b) =>
  `${c.largeur}x${c.hauteur} S=${c.nomS} T=${c.nomT} uv=(${c.u}, ${c.v}) ${a} ≠ ${b}`;
const texel = (cote) => (c, k) => {
  const { i, [cote]: valeurs } = lecture.nearest.get(c);
  const lu = [0, 1].map((j) => Math.round((valeurs[i * 4 + j] * 255 - 20) / 40));
  return lu[k] === c.attendu[k] ? null : exemple(c, `Three=${c.attendu}`, `lu=${lu}`);
};
const lineaire = (c, k) => {
  const { i, moteur, three } = lecture.linear.get(c);
  const a = moteur[i * 4 + k],
    b = three[i * 4 + k];
  return Object.is(a, b) ? null : exemple(c, `moteur=${a * 255}`, `Three=${b * 255}`);
};

const n = tous.length;
bilan(
  `Échantillonneur de Three au plus proche contre la règle de référence (${n} cas)`,
  tous,
  texel('three'),
);
const proches = bilan(
  `WGSL du moteur au plus proche contre Three (${n} cas)`,
  tous,
  texel('moteur'),
);
const lineaires = bilan(
  `WGSL du moteur en linéaire contre Three, bit à bit (${n} cas)`,
  tous,
  lineaire,
);
const bloquants =
  somme(proches, (cle) => !cle.includes('frontière')) +
  somme(lineaires, (cle) => !cle.startsWith('Repeat') || cle.includes('axe fixé'));
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(sorties.map((s) => s.moteur)));
console.log(`\nGPU : ${bloquants} écarts bloquants`);
process.exitCode = bloquants ? 1 : 0;
