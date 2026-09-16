// Défaut 4, côté carte graphique : le WGSL d'adressage du moteur exécuté dans Chromium WebGPU, sur
// une vraie texture à texels distincts, à côté du vrai échantillonneur réglé comme Three règle le
// sien (mode de la carte → `addressMode`). Deux filtrages : au plus proche (le texel choisi) et
// linéaire (le filtrage réel de l'échantillonneur du moteur, comparé bit à bit).
//   LAB_ROOT=…/render-tech-lab node --experimental-strip-types \
//     packages/sdk-browser/bench/justesse/adressage-gpu.mjs [sortie.json]
// Bloquant : tout écart au plus proche hors frontière ; tout écart linéaire bit à bit hors couture ;
// et, sur la couture d'une période, toute lecture qui s'écarte de la règle exacte de plus d'un demi
// niveau sur 255 — le mélange que le moteur écrit lui-même ne peut pas retrouver, bit pour bit, le
// poids que l'échantillonneur quantifie, mais il doit rendre la même couleur à ce niveau près.
// Pour mémoire seulement : au plus proche sur une frontière exacte, le texel dépend de l'arrondi
// 32 bits de u·taille.
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { WRAP_COORD_WGSL, wrapFlags } from '../../visibilityPageWgsl.ts';
import {
  bilan,
  cas,
  lineaireThree,
  melange,
  octetsTexture,
  somme,
  TAILLES,
} from './adressageCas.mjs';
import { executerDansChromium } from './adressageGpuPage.mjs';

/** Les drapeaux écrits par `webgpuPageRow.ts` et `webgpuBlendPrepare.ts`, par la même fonction. */
const drapeaux = (c) => wrapFlags({ wrapS: c.wrapS, wrapT: c.wrapT });
/** Le bit qui, dans ce banc seul, demande le mélange des prises : les lots au plus proche ne
 *  veulent qu'un texel, les lots linéaires la lecture entière. `wrapUv` ne lit pas ce bit. */
const MELANGE = 1;
/** Un demi niveau sur 255 : la quantification du poids que l'échantillonneur s'autorise. */
const TOLERANCE = 0.5;

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
// Le mélange des quatre prises, transcrit du gabarit que webgpuAtlasWgsl.ts engendre pour
// colorSample, dataSample et colorAlpha : mêmes prises, même ordre, même expression.
@fragment fn fs(@builtin(position) q:vec4f)->Sortie{
 let c=lot[u32(q.x)];
 let t=wrapUv(c.uv,c.flags,vec2f(textureDimensions(maps,0)));
 var lu=textureSampleLevel(maps,moteur,t.proche,0,0.0);
 if((c.flags&${MELANGE}u)!=0u&&t.couture){
  let s10=textureSampleLevel(maps,moteur,vec2f(t.loin.x,t.proche.y),0,0.0);
  let s01=textureSampleLevel(maps,moteur,vec2f(t.proche.x,t.loin.y),0,0.0);
  let s11=textureSampleLevel(maps,moteur,t.loin,0,0.0);
  lu=mix(mix(lu,s10,t.poids.x),mix(s01,s11,t.poids.x),t.poids.y);
 }
 return Sortie(lu,textureSampleLevel(maps,three,c.uv,0,0.0));
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
          flags: membres.map((c) => drapeaux(c) | (filtre === 'linear' ? MELANGE : 0)),
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
/** La couleur exacte de la règle : les deux texels de l'axe `k`, mêlés en double précision. */
const regle = (c, k) =>
  melange(lineaireThree(k ? c.v : c.u, k ? c.hauteur : c.largeur, k ? c.wrapT : c.wrapS));
/** L'écart d'un côté à la règle exacte, en niveaux sur 255 ; `null` sous la tolérance. */
const contreRegle = (cote) => (c, k) => {
  const { i, [cote]: valeurs } = lecture.linear.get(c);
  const lu = valeurs[i * 4 + k] * 255,
    attendu = regle(c, k);
  return Math.abs(lu - attendu) <= TOLERANCE ? null : exemple(c, `lu=${lu}`, `règle=${attendu}`);
};
/** Le pire écart d'un côté à la règle, toutes composantes éprouvées : le bruit propre du filtrage. */
const pire = (cote) =>
  tous.reduce((m, c) => {
    const { i, [cote]: valeurs } = lecture.linear.get(c);
    const k = c.axe === 'u' ? 0 : 1;
    return Math.max(m, Math.abs(valeurs[i * 4 + k] * 255 - regle(c, k)));
  }, 0);

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
bilan(
  `Échantillonneur de Three en linéaire contre la règle exacte, ±${TOLERANCE}/255 (${n} cas)`,
  tous,
  contreRegle('three'),
);
const exacts = bilan(
  `WGSL du moteur en linéaire contre la règle exacte, ±${TOLERANCE}/255 (${n} cas)`,
  tous,
  contreRegle('moteur'),
);
console.log(
  `\nPire écart à la règle exacte : moteur ${pire('moteur').toFixed(4)}/255,` +
    ` échantillonneur de Three ${pire('three').toFixed(4)}/255`,
);
const bloquants =
  somme(proches, (cle) => !cle.includes('frontière')) +
  somme(lineaires, (cle) => !cle.includes('couture')) +
  somme(exacts);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(sorties.map((s) => s.moteur)));
console.log(`\nGPU : ${bloquants} écarts bloquants`);
process.exitCode = bloquants ? 1 : 0;
