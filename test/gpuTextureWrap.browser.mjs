// Défauts 4 et 7, GPU : le WGSL de production (`wrapUv`/`wrapCoord`, visibilityPageWgsl.ts)
// échantillonné par une vraie carte graphique WebGPU dans Chromium (Playwright de render-tech-lab,
// en lecture seule), contre l'échantillonneur natif réglé sur le même mode d'adressage — le tout sur
// une texture à texels tous distincts, en filtrage linéaire. Deux séries :
//   • hors couture de période, miroir, répétition et serrage restent identiques bit à bit ;
//   • sur la couture d'une période en répétition, le moteur mêle lui-même les deux bords de la
//     texture ; son poids ne peut pas valoir bit pour bit celui que l'échantillonneur quantifie, la
//     couleur rendue est donc comparée à la règle exacte, à un demi niveau sur 255 près.
// `executerDansChromium` (bench/justesse/adressageGpuPage.mjs) porte l'orchestration WebGPU déjà
// vérifiée par la reproduction du lot ; ce test n'écrit que ses propres cas et son propre nuanceur,
// structurés différemment de la reproduction pour rester une preuve indépendante.
//
//   LAB_ROOT=…/render-tech-lab node --experimental-strip-types test/gpuTextureWrap.browser.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WRAP_COORD_WGSL } from '../packages/sdk-browser/visibilityPageWgsl.ts';
import { wrapNibble } from '../packages/sdk-browser/visibilityWrapModes.ts';
import {
  lineaireThree,
  melange,
  octetsTexture,
  surCouture,
} from '../packages/sdk-browser/bench/justesse/adressageCas.mjs';
import { executerDansChromium } from '../packages/sdk-browser/bench/justesse/adressageGpuPage.mjs';

// Le nuanceur attendu par `executerDansChromium` : une texture, un échantillonneur « moteur » (le
// WGSL de production sous serrage, comme l'atlas), un échantillonneur « three » réglé au mode natif,
// un lot de cas empaquetés (uv, quartet d'adressage). Reste écrit ici, à la ligne, sans la mise en
// forme compacte de la reproduction ; le mélange des quatre prises est celui que
// webgpuAtlasWgsl.ts engendre pour colorSample, dataSample et colorAlpha.
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
  let prises = wrapUv(entree.uv, entree.flags, vec2f(textureDimensions(maps, 0)));
  var lu = textureSampleLevel(maps, moteur, prises.proche, 0, 0.0);
  if (prises.couture) {
    let s10 = textureSampleLevel(maps, moteur, vec2f(prises.loin.x, prises.proche.y), 0, 0.0);
    let s01 = textureSampleLevel(maps, moteur, vec2f(prises.proche.x, prises.loin.y), 0, 0.0);
    let s11 = textureSampleLevel(maps, moteur, prises.loin, 0, 0.0);
    lu = mix(mix(lu, s10, prises.poids.x), mix(s01, s11, prises.poids.x), prises.poids.y);
  }
  return Sortie(lu, textureSampleLevel(maps, three, entree.uv, 0, 0.0));
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
// comme référence du lot (texel 2 en miroir). Aucun ne tombe dans le demi-texel d'un bord.
const UV = [-1000.375, -2.375, -0.625, 0.375, 0.625, 1.25, 2.625, 1000.625].flatMap((t) => [
  [t, 0.625],
  [0.375, t],
]);

// Le demi-texel des deux bords d'une période, sur un axe puis sur l'autre puis sur les deux : c'est
// là que la règle mêle le dernier texel et le premier, et que replier la coordonnée les sépare.
const COUTURES = [0, 0.02, 0.999, -0.01, -3, 1000.04, 2.98].flatMap((t) => [
  [t, 0.625],
  [0.375, t],
  [t, t],
]);

const MODES = [
  { nom: 'MirroredRepeat', wrap: THREE.MirroredRepeatWrapping, adresse: 'mirror-repeat' },
  { nom: 'Repeat', wrap: THREE.RepeatWrapping, adresse: 'repeat' },
  { nom: 'ClampToEdge', wrap: THREE.ClampToEdgeWrapping, adresse: 'clamp-to-edge' },
];

const lots = [UV, COUTURES].flatMap((uv) =>
  MODES.map(({ wrap, adresse }) => ({
    filtre: 'linear',
    texture: 0,
    adresseS: adresse,
    adresseT: adresse,
    uv: uv.flat(),
    flags: uv.map(() => wrapNibble({ wrapS: wrap, wrapT: wrap })),
  })),
);

const sorties = await executerDansChromium({ shader: NUANCEUR, textures: [texture], lots });

/** Un demi niveau sur 255 : la quantification du poids que l'échantillonneur s'autorise. */
const TOLERANCE = 0.5;
/** La couleur exacte de la règle sur l'axe de la composante `k`, les deux texels mêlés. */
const regle = (uv, wrap, k) => melange(lineaireThree(uv[k], k ? HAUTEUR : LARGEUR, wrap)) / 255;

let ecarts = 0,
  couturesEprouvees = 0;
lots.forEach(({ uv: plat }, rang) => {
  const { nom, wrap } = MODES[rang % MODES.length];
  const { moteur, three } = sorties[rang];
  for (let i = 0; i < plat.length / 2; i++) {
    const uv = [plat[i * 2], plat[i * 2 + 1]];
    for (let k = 0; k < 2; k++) {
      const couture = surCouture(uv[k], k ? HAUTEUR : LARGEUR, wrap);
      const a = moteur[i * 4 + k];
      if (!couture) {
        if (Object.is(a, three[i * 4 + k])) continue;
        ecarts++;
        console.error(`${nom} uv=(${uv}) composante ${k} : moteur=${a} carte=${three[i * 4 + k]}`);
        continue;
      }
      couturesEprouvees++;
      const attendu = regle(uv, wrap, k);
      if (Math.abs(a - attendu) * 255 <= TOLERANCE) continue;
      ecarts++;
      console.error(`${nom} uv=(${uv}) composante ${k} : moteur=${a * 255} règle=${attendu * 255}`);
    }
  }
});

assert.equal(
  ecarts,
  0,
  `${ecarts} écarts entre le WGSL du moteur et la règle de l'échantillonneur`,
);
assert.ok(couturesEprouvees > 0, 'aucune couture de période éprouvée');
console.log(
  `GPU adressage miroir/répétition/serrage : 0 écart sur ${lots.length} lots,` +
    ` dont ${couturesEprouvees} composantes sur la couture d'une période, filtrage linéaire.`,
);
