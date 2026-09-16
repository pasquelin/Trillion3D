// Défaut 8, côté carte graphique : un matériau dont les cartes n'ont pas le même mode d'adressage.
// La ligne de page est écrite par le vrai `createPageRowWriter`, et le mot d'adressage que le
// nuanceur donne à chaque carte en est relu par `wrapOf`, le miroir processeur du `wrapOf` WGSL.
// Chaque carte est ensuite lue par le WGSL d'adressage du moteur, dans Chromium, et comparée à
// l'échantillonneur natif réglé sur le mode de cette carte-là — la référence des lots 4 et 7.
//   LAB_ROOT=…/render-tech-lab node --experimental-strip-types \
//     packages/sdk-browser/bench/justesse/adressage-cartes-gpu.mjs
// Bloquant : tout écart bit à bit hors couture de période, et sur la couture toute lecture qui
// s'écarte de la règle exacte de plus d'un demi niveau sur 255.
import * as THREE from 'three';
import { wrapOf } from '../../visibilityWrapModes.ts';
import { ROW_WRAP_MODES_WORD } from '../../webgpuPageRow.ts';
import { lineaireThree, melange, surCouture } from './adressageCas.mjs';
import { executerDansChromium, MELANGE, NUANCEUR_PRISES } from './adressageGpuPage.mjs';
import { CARTES, ligneDePageMelangee, TEXTURE, UV } from './adressageCartes.mjs';

/** Un demi niveau sur 255 : la quantification du poids que l'échantillonneur s'autorise. */
const TOLERANCE = 0.5;
const ADRESSE = new Map([
  [THREE.ClampToEdgeWrapping, 'clamp-to-edge'],
  [THREE.RepeatWrapping, 'repeat'],
  [THREE.MirroredRepeatWrapping, 'mirror-repeat'],
]);

const { ints } = ligneDePageMelangee();
const lots = CARTES.map(({ carte, wrapS, wrapT }) => ({
  filtre: 'linear',
  texture: 0,
  adresseS: ADRESSE.get(wrapS),
  adresseT: ADRESSE.get(wrapT),
  uv: UV.flat(),
  flags: UV.map(() => wrapOf(ints[ROW_WRAP_MODES_WORD], carte) | MELANGE),
}));

const sorties = await executerDansChromium({
  shader: NUANCEUR_PRISES,
  textures: [TEXTURE],
  lots,
});

/** La couleur exacte de la règle sur l'axe de la composante `k`, les deux texels mêlés. */
const regle = (uv, wrap, k) =>
  melange(lineaireThree(uv[k], k ? TEXTURE.hauteur : TEXTURE.largeur, wrap)) / 255;

let bloquants = 0,
  couturesEprouvees = 0;
console.log("\nDéfaut 8 : une carte par mode, lue par le WGSL d'adressage du moteur");
CARTES.forEach(({ nom, wrapS, wrapT }, rang) => {
  const { moteur, three } = sorties[rang];
  let ecarts = 0,
    pire = 0,
    exemple = null;
  UV.forEach((uv, i) => {
    for (let k = 0; k < 2; k++) {
      const wrap = k ? wrapT : wrapS,
        taille = k ? TEXTURE.hauteur : TEXTURE.largeur;
      const lu = moteur[i * 4 + k];
      if (!surCouture(uv[k], taille, wrap)) {
        if (Object.is(lu, three[i * 4 + k])) continue;
        ecarts++;
        pire = Math.max(pire, Math.abs(lu - three[i * 4 + k]) * 255);
        exemple ??= `uv=(${uv}) composante ${k} : moteur=${lu * 255} carte=${three[i * 4 + k] * 255}`;
        continue;
      }
      couturesEprouvees++;
      const attendu = regle(uv, wrap, k);
      if (Math.abs(lu - attendu) * 255 <= TOLERANCE) continue;
      ecarts++;
      pire = Math.max(pire, Math.abs(lu - attendu) * 255);
      exemple ??= `uv=(${uv}) composante ${k} : moteur=${lu * 255} règle=${attendu * 255}`;
    }
  });
  bloquants += ecarts;
  const modes = `${ADRESSE.get(wrapS)}/${ADRESSE.get(wrapT)}`;
  console.log(
    `  ${nom.padEnd(10)} ${modes.padEnd(28)} ${String(ecarts).padStart(3)} écarts / ${UV.length * 2}` +
      `${ecarts ? `  pire ${pire.toFixed(2)}/255  ex. ${exemple}` : ''}`,
  );
});
console.log(`\n${couturesEprouvees} composantes éprouvées sur la couture d'une période`);
console.log(`GPU, une carte par mode : ${bloquants} écarts bloquants`);
process.exitCode = bloquants ? 1 : 0;
