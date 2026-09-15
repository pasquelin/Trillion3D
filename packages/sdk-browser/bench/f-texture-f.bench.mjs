// F15 : les octets d'une texture échantillonnée. `sampleMap`, `sampleLinear` et le test alpha du
// rastériseur appellent `textureRgba` une fois par texel lu ; chaque appel allouait une vue
// `Uint8Array` et un objet. La mémoire revérifie la source à chaque appel — tampon, décalage,
// longueur, largeur, hauteur — donc une image remplacée rend bien les nouveaux octets.
import { textureRgba } from '../visibilityTypes.ts';
import { compare, graine } from '../../sdk-core/bench/banc.mjs';
import { verifieEtDeposeF } from '../../sdk-core/bench/bancF.mjs';
import { referenceTextureRgba } from './oracles/f-texture.mjs';

const alea = graine(3313);
/** Des textures : normale, remplacée en cours de route, sans données, minuscule, immense. */
const octets = (n) => {
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.floor(alea() * 256);
  return data;
};
const texture = (largeur, hauteur) => ({
  image: { data: octets(largeur * hauteur * 4), width: largeur, height: hauteur },
});
const grandeTexture = texture(512, 512),
  minuscule = texture(1, 1),
  sansDonnees = { image: { width: 4, height: 4 } },
  sansImage = {},
  zero = { image: { data: new Uint8Array(0), width: 0, height: 0 } };
/** Deux contenus figés : la texture remplacée est refabriquée à chaque appel, des deux côtés. */
const contenuAvant = octets(16 * 16 * 4),
  contenuApres = octets(8 * 8 * 4);
const vueDecalee = new Uint8Array(new ArrayBuffer(4096), 128, 1024);
const decalee = { image: { data: vueDecalee, width: 16, height: 16 } };

/** Cent mille lectures de texel, comme une passe de rastérisation à test alpha. */
const passeTexture = (fn) => (entree) => {
  const somme = new Float64Array(4);
  let nuls = 0;
  const cibles = entree.remplacer
    ? [{ image: { data: contenuAvant, width: 16, height: 16 } }]
    : entree.textures;
  for (let tour = 0; tour < entree.tours; tour++)
    for (const cible of cibles) {
      if (entree.remplacer && tour === 1) cible.image = { data: contenuApres, width: 8, height: 8 };
      const rgba = fn(cible);
      if (!rgba) {
        nuls++;
        continue;
      }
      const index = ((tour * 7) % Math.max(1, rgba.width * rgba.height)) * 4;
      somme[0] += rgba.data[index] ?? -1;
      somme[1] += rgba.width;
      somme[2] += rgba.height;
      somme[3] += rgba.data.byteLength;
    }
  return { somme, nuls };
};

const toutes = [grandeTexture, minuscule, decalee, sansDonnees, sansImage, zero];
const casTexture = [
  {
    nom: '100 000 lectures de texel',
    entree: { textures: [grandeTexture], tours: 100000 },
    taille: 100000,
  },
  { nom: 'textures limites et absentes', entree: { textures: toutes, tours: 200 }, taille: 1200 },
  {
    nom: 'image remplacée en cours de route',
    entree: { textures: [], tours: 4, remplacer: true },
    taille: 4,
  },
  { nom: 'aucune texture', entree: { textures: [], tours: 10 }, taille: 0 },
];

const lignes = [
  await compare({
    calcul: 'F15 octets d’une texture échantillonnée',
    fichier: 'packages/sdk-browser/visibilityTypes.ts',
    cas: casTexture,
    reference: passeTexture(referenceTextureRgba),
    optimisee: passeTexture(textureRgba),
    options: { chauffe: 5, tours: 200, budgetMs: 3000 },
  }),
];

verifieEtDeposeF('f-texture', 'F15 rend exactement les mêmes octets de texture', lignes);
