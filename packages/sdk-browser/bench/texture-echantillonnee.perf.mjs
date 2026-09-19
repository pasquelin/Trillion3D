// the bytes of a sampled texture.
import { textureRgba } from '../visibilityTypes.ts';
import { graine, mesure, stress, rapport } from '../../sdk-core/bench/socle.mjs';
import { referenceTextureRgba } from './oracles/texture-echantillonnee.mjs';

const alea = graine(3313);
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
const contenuAvant = octets(16 * 16 * 4),
  contenuApres = octets(8 * 8 * 4);
const vueDecalee = new Uint8Array(new ArrayBuffer(4096), 128, 1024);
const decalee = { image: { data: vueDecalee, width: 16, height: 16 } };

const passeTexture = (fn) => (input) => {
  const somme = new Float64Array(4);
  let nuls = 0;
  const cibles = input.remplacer
    ? [{ image: { data: contenuAvant, width: 16, height: 16 } }]
    : input.textures;
  for (let tour = 0; tour < input.tours; tour++)
    for (const cible of cibles) {
      if (input.remplacer && tour === 1) cible.image = { data: contenuApres, width: 8, height: 8 };
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
    name: '100 000 texel reads',
    input: { textures: [grandeTexture], tours: 100000 },
    size: 100000,
  },
  {
    name: 'edge cases: offset, no image, empty',
    input: { textures: toutes, tours: 10000 },
    size: toutes.length * 10000,
  },
  {
    name: 'texture replaced mid-way',
    input: { remplacer: true, tours: 4 },
    size: 4,
  },
];

const resTexture = await mesure({
  name: 'textureRgba',
  fichier: 'packages/sdk-browser/visibilityTypes.ts',
  cas: casTexture,
  calcul: passeTexture(textureRgba),
  attendu: passeTexture(referenceTextureRgba),
  options: { tours: 40, budgetMs: 1500 },
});

await stress({
  name: 'textureRgba extremes',
  calcul: (t) => textureRgba(t),
  extremes: [
    { name: 'sansImage', input: sansImage },
    { name: 'zero', input: zero },
  ],
});

rapport('texture-echantillonnee', [resTexture], 'F15 yields the exact same bytes and dimensions');
