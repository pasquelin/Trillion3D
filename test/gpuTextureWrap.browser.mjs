// Défaut 4, GPU : le WGSL de production (`wrapUv`/`wrapCoord`, visibilityPageWgsl.ts) échantillonné
// par une vraie carte graphique WebGPU dans Chromium (Playwright de render-tech-lab, en lecture
// seule), contre l'échantillonneur natif réglé sur le même mode d'adressage — le tout sur une
// texture à texels tous distincts, en filtrage linéaire. Miroir, répétition et serrage : 0 écart
// bit à bit. `executerDansChromium` (bench/justesse/adressageGpuPage.mjs) porte l'orchestration
// WebGPU déjà vérifiée par la reproduction du lot ; ce test n'écrit que son propre cas et son
// propre nuanceur, structurés différemment de la reproduction pour rester une preuve indépendante.
//
//   LAB_ROOT=…/render-tech-lab node --experimental-strip-types test/gpuTextureWrap.browser.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WRAP_COORD_WGSL, wrapFlags } from '../packages/sdk-browser/visibilityPageWgsl.ts';
import { octetsTexture } from '../packages/sdk-browser/bench/justesse/adressageCas.mjs';
import { executerDansChromium } from '../packages/sdk-browser/bench/justesse/adressageGpuPage.mjs';

// Le nuanceur attendu par `executerDansChromium` : une texture, un échantillonneur « moteur » (le
// WGSL de production sous serrage, comme l'atlas), un échantillonneur « three » réglé au mode natif,
// un lot de cas empaquetés (uv, drapeaux). Reste écrit ici, à la ligne, sans reprendre la mise en
// forme compacte de la reproduction.
const NUANCEUR = `
${WRAP_COORD_WGSL}

struct Cas {
  uv: vec2f,
  flags: u32,
  pad: u32,
}

@group(0) @binding(0) var maps: texture_2d_array<f32>;
@group(0) @binding(1) var moteur: sampler;
@group(0) @binding(2) var three: sampler;
@group(0) @binding(3) var<storage, read> lot: array<Cas>;

struct Sortie {
  @location(0) moteur: vec4f,
  @location(1) three: vec4f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let coin = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(coin[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) q: vec4f) -> Sortie {
  let entree = lot[u32(q.x)];
  let corrigee = wrapUv(entree.uv, entree.flags);
  return Sortie(
    textureSampleLevel(maps, moteur, corrigee, 0, 0.0),
    textureSampleLevel(maps, three, entree.uv, 0, 0.0),
  );
}
`;

// Une texture 4×3, tous texels distincts (rouge = 20+40x, vert = 20+40y, alpha = 10+10·rang).
const LARGEUR = 4,
  HAUTEUR = 3;
const texture = {
  largeur: LARGEUR,
  hauteur: HAUTEUR,
  octets: Array.from(octetsTexture(LARGEUR, HAUTEUR)),
};

// Des uv hors frontière exacte (le filtrage linéaire y est sans ambiguïté d'arrondi) : négatifs,
// proches d'un entier, demi-texel, grands (±1e3) — dont u = 1,25 sur 4 texels, la valeur retenue
// comme référence du lot (texel 2 en miroir).
const UV = [-1000.375, -2.375, -0.625, 0.375, 0.625, 1.25, 2.625, 1000.625].flatMap((t) => [
  [t, 0.625],
  [0.375, t],
]);

const MODES = [
  { nom: 'MirroredRepeat', wrap: THREE.MirroredRepeatWrapping, adresse: 'mirror-repeat' },
  { nom: 'Repeat', wrap: THREE.RepeatWrapping, adresse: 'repeat' },
  { nom: 'ClampToEdge', wrap: THREE.ClampToEdgeWrapping, adresse: 'clamp-to-edge' },
];

const lots = MODES.map(({ wrap, adresse }) => ({
  filtre: 'linear',
  texture: 0,
  adresseS: adresse,
  adresseT: adresse,
  uv: UV.flat(),
  flags: UV.map(() => wrapFlags({ wrapS: wrap, wrapT: wrap })),
}));

const sorties = await executerDansChromium({ shader: NUANCEUR, textures: [texture], lots });

let ecarts = 0;
sorties.forEach(({ moteur, three }, m) => {
  for (let i = 0; i < UV.length; i++)
    for (let k = 0; k < 4; k++) {
      const a = moteur[i * 4 + k],
        b = three[i * 4 + k];
      if (!Object.is(a, b)) {
        ecarts++;
        console.error(`${MODES[m].nom} uv=(${UV[i]}) composante ${k} : moteur=${a} carte=${b}`);
      }
    }
});

assert.equal(ecarts, 0, `${ecarts} écarts entre le WGSL du moteur et l'échantillonneur natif`);
console.log(
  `GPU adressage en miroir/répétition/serrage : 0 écart sur ${MODES.length} modes × ${UV.length} uv, filtrage linéaire.`,
);
