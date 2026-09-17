// Banc de performance : décodage complet du manifeste binaire (colonnes et métadonnées).
import { decodeManifestBinary, encodeManifestBinary } from '../manifestBinary.ts';
import { TEMPLATES, manifest as baseManifest, sha } from '../../../test/fixtures/manifestBinary.ts';
import { mesure, rapport } from './mesure.mjs';

function creeScene(nbPages) {
  const base = baseManifest();
  const templatePage = base.primitives[0].pages[0];
  const pages = [];
  for (let i = 0; i < nbPages; i++) {
    pages.push({
      ...templatePage,
      id: i,
      lodError: i * 0.001,
      min: [-i, -i, -i],
      max: [i, i, i],
      sphere: [0, 0, 0, Math.max(1, i)],
    });
  }
  const manifest = {
    ...base,
    primitives: [{ ...base.primitives[0], pages }],
  };
  const { manifest: slim, binary } = encodeManifestBinary(manifest, TEMPLATES);
  slim.binary.sha256 = sha('f');
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  const jsonSlim = JSON.parse(JSON.stringify(slim));
  return { jsonSlim, buffer, nbPages, attendu: manifest.primitives[0].pages.length };
}

const cas100 = creeScene(100);
const cas1000 = creeScene(1000);
const cas5000 = creeScene(5000);

const options = { chauffe: 1, tours: 5, budgetMs: 300 };

const mesureDecodage = await mesure({
  nom: 'décodage manifeste binaire',
  fichier: 'packages/sdk-core/manifestBinary.ts',
  cas: [
    { nom: '100 pages de clusters', entree: cas100, taille: 100 },
    { nom: '1 000 pages de clusters', entree: cas1000, taille: 1000 },
    { nom: '5 000 pages de clusters', entree: cas5000, taille: 5000 },
  ],
  calcul: ({ jsonSlim, buffer }) => {
    const decoded = decodeManifestBinary(jsonSlim, buffer);
    return decoded.primitives[0].pages.length;
  },
  attendu: ({ attendu }) => attendu,
  options,
});

rapport(
  'decodage-manifeste',
  mesureDecodage,
  'le décodage binaire restitue exactement toutes les pages du manifeste',
);
