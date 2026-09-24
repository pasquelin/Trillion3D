// the bytes of a sampled texture.
import type { Texture } from '../../../packages/sdk-core/src/index.ts';
import { importHostTexture } from '../../../packages/sdk-browser/src/host/surfaceImport.ts';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { textureRgba } from '../../../packages/sdk-browser/src/visibility/types.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import { referenceTextureRgba } from '../../oracles/browser/sampled-texture.ts';

const alea = graine(3313);
const octets = (n: number) => {
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = Math.floor(alea() * 256);
  return data;
};
const texture = (largeur: number, hauteur: number) => {
  const t = new G.GraphTexture();
  t.image = { data: octets(largeur * hauteur * 4), width: largeur, height: hauteur };
  return t;
};
const grandeTexture = texture(512, 512),
  minuscule = texture(1, 1);
const sansDonnees = new G.GraphTexture();
sansDonnees.image = { width: 4, height: 4 };
const sansImage = new G.GraphTexture();
const zero = new G.GraphTexture();
zero.image = { data: new Uint8Array(0), width: 0, height: 0 };
const contenuAvant = octets(16 * 16 * 4),
  contenuApres = octets(8 * 8 * 4);
const vueDecalee = new Uint8Array(new ArrayBuffer(4096), 128, 1024);
const decalee = new G.GraphTexture();
decalee.image = { data: vueDecalee, width: 16, height: 16 };

interface CasTexture {
  textures?: G.GraphTexture[];
  tours: number;
  remplacer?: boolean;
}

const passeTexture =
  (fn: (t: Texture) => { data: Uint8Array; width: number; height: number } | null) =>
  (input: CasTexture) => {
    const somme = new Float64Array(4);
    let nuls = 0;
    const cibles = input.remplacer
      ? [
          (() => {
            const t = new G.GraphTexture();
            t.image = { data: contenuAvant, width: 16, height: 16 };
            return t;
          })(),
        ]
      : (input.textures ?? []);
    for (let tour = 0; tour < input.tours; tour++)
      for (const cible of cibles) {
        if (input.remplacer && tour === 1)
          cible.image = { data: contenuApres, width: 8, height: 8 };
        // The engine reads the imported record; the host object is what a bench may still mutate.
        const rgba = fn(importHostTexture(cible));
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
  fichier: 'packages/sdk-browser/src/visibility/types.ts',
  cas: casTexture,
  calcul: passeTexture(textureRgba),
  attendu: passeTexture(referenceTextureRgba),
  options: { tours: 40, budgetMs: 1500 },
});

await stress({
  name: 'textureRgba extremes',
  calcul: (t: G.GraphTexture) => textureRgba(importHostTexture(t)),
  extremes: [
    { name: 'sansImage', input: sansImage },
    { name: 'zero', input: zero },
  ],
});

rapport('texture-echantillonnee', [resTexture], 'F15 yields the exact same bytes and dimensions');
