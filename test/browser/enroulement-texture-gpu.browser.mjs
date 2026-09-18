// Défauts 4 et 7, GPU : le WGSL de production (`wrapUv`/`wrapCoord`, visibilityWrapModes.ts)
// échantillonné par une vraie carte graphique WebGPU dans Chromium, contre l'échantillonneur natif
// réglé sur le même mode d'adressage — le tout sur une texture à texels tous distincts, en filtrage
// linéaire. Deux séries :
//   • hors couture de période, miroir, répétition et serrage restent identiques bit à bit ;
//   • sur la couture d'une période en répétition, le moteur mêle lui-même les deux bords de la
//     texture ; son poids ne peut pas valoir bit pour bit celui que l'échantillonneur quantifie, la
//     couleur rendue est donc comparée à la règle exacte, à un demi niveau sur 255 près.
// `adressageGpuPage.mjs` (test/justesse) porte l'orchestration WebGPU et le nuanceur des prises,
// déjà vérifiés par la reproduction du lot ; ce test écrit ses propres cas, structurés autrement que
// ceux de la reproduction pour rester une preuve indépendante. Le nuanceur, lui, n'est pas recopié :
// deux copies seraient deux chances de voir la lecture éprouvée dériver de celle de production.
//
//   node --experimental-strip-types test/browser/enroulement-texture-gpu.browser.mjs
import assert from 'node:assert/strict';
import { wrapNibble } from '../../packages/sdk-browser/visibilityWrapModes.ts';
import {
  MODES_GPU,
  octetsTexture,
  regleNormalisee,
  surCouture,
  TOLERANCE,
} from '../justesse/adressageCas.mjs';
import { executerDansChromium, MELANGE, NUANCEUR_PRISES } from '../justesse/adressageGpuPage.mjs';

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

const lots = [UV, COUTURES].flatMap((uv) =>
  MODES_GPU.map(({ wrap, adresse }) => ({
    filtre: 'linear',
    texture: 0,
    adresseS: adresse,
    adresseT: adresse,
    uv: uv.flat(),
    // `MELANGE` demande au nuanceur des prises la lecture entière : ce banc n'éprouve que le
    // filtrage linéaire, dont le mélange des quatre prises sur la couture d'une période.
    flags: uv.map(() => wrapNibble({ wrapS: wrap, wrapT: wrap }) | MELANGE),
  })),
);

const sorties = await executerDansChromium({
  shader: NUANCEUR_PRISES,
  textures: [texture],
  lots,
});

/** La couleur exacte de la règle sur l'axe de la composante `k`, les deux texels mêlés. */
const regle = (uv, wrap, k) => regleNormalisee(uv[k], k ? HAUTEUR : LARGEUR, wrap);

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
