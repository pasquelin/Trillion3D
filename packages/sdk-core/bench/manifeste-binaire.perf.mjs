// F19 : l'écriture des empreintes d'un manifeste binaire.
import { writeSha } from '../manifestBinaryLayout.ts';
import { graine, mesure, stress, rapport } from './mesure.mjs';
import { referenceWriteSha } from './oracles/manifeste-binaire.mjs';

const alea = graine(211);
const HEX = '0123456789abcdef';
const empreinte = () => {
  let sortie = '';
  for (let i = 0; i < 64; i++) sortie += HEX[Math.floor(alea() * 16)];
  return sortie;
};

const PAGES = 40000;
const valides = [];
for (let i = 0; i < PAGES; i++) valides.push(empreinte());
const zeros = '0'.repeat(63);
const refusees = [
  '',
  'a',
  zeros,
  `${zeros}00`,
  'A'.repeat(64),
  'g'.repeat(64),
  `${zeros} `,
  `${zeros}/`,
  `${zeros}:`,
  `${zeros}\u0000`,
  `${zeros}\u00e9`,
  `${zeros}\uD83D`,
];

const passe = (fn) => (entree) => {
  const colonne = new Uint8Array(Math.max(1, entree.liste.length) * 64).fill(0xff);
  const refus = [];
  for (let i = 0; i < entree.liste.length; i++) {
    try {
      fn(colonne, i, entree.liste[i]);
      refus.push(null);
    } catch (erreur) {
      refus.push(erreur.message);
    }
  }
  return { colonne, refus };
};

const cas = [
  { nom: '40 000 empreintes valides', entree: { liste: valides }, taille: PAGES },
  { nom: 'empreintes refusées', entree: { liste: refusees }, taille: refusees.length },
  { nom: 'une seule empreinte', entree: { liste: [valides[0]] }, taille: 1 },
  { nom: 'aucune empreinte', entree: { liste: [] }, taille: 0 },
];

const res = await mesure({
  nom: 'F19 empreintes du manifeste binaire',
  fichier: 'packages/sdk-core/manifestBinaryLayout.ts',
  cas,
  calcul: passe(writeSha),
  attendu: passe(referenceWriteSha),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  nom: 'writeSha extremes',
  calcul: (s) => {
    const col = new Uint8Array(64);
    try {
      writeSha(col, 0, s);
    } catch {
      // Rejets attendus
    }
  },
  extremes: [
    { nom: 'chaine vide', entree: '' },
    { nom: 'null char', entree: '\0' },
    { nom: 'trop long', entree: 'a'.repeat(200) },
  ],
});

rapport(
  'f-manifeste',
  [res],
  'F19 écrit exactement les mêmes octets et refuse exactement les mêmes empreintes',
);
