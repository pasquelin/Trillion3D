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
import { wrapNibble } from '../../visibilityWrapModes.ts';
import {
  ADRESSE,
  bilan,
  cas,
  lineaireThree,
  melange,
  octetsTexture,
  somme,
  TAILLES,
  TOLERANCE,
} from './adressageCas.mjs';
import { executerDansChromium, MELANGE, NUANCEUR_PRISES } from './adressageGpuPage.mjs';

/** Le quartet d'adressage d'une carte, celui que `webgpuPageRow.ts` et `webgpuBlendPrepare.ts`
 *  rangent dans le mot de la page, par la même fonction. */
const drapeaux = (c) => wrapNibble({ wrapS: c.wrapS, wrapT: c.wrapT });

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
  shader: NUANCEUR_PRISES,
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
