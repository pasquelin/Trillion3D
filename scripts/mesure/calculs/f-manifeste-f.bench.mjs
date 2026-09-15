// F19 : l'écriture des empreintes d'un manifeste binaire. L'expression régulière parcourait les 64
// caractères, puis la boucle d'écriture les parcourait de nouveau — pour chaque page, chaque
// géométrie, chaque paquet et chaque aperçu d'un manifeste qui en compte des dizaines de milliers.
import { writeSha } from '../../../packages/sdk-core/manifestBinaryLayout.ts';
import { compare, graine } from './banc.mjs';
import { verifieEtDeposeF } from './bancF.mjs';
import { referenceWriteSha } from './oracles/f-manifeste.mjs';

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
/** Empreintes refusées : trop courte, trop longue, majuscule, hors alphabet, vide, caractère nul. */
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

/** L'état complet de la colonne après l'écriture, et le refus rendu mot pour mot par chaque entrée. */
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

const lignes = [
  await compare({
    calcul: 'F19 empreintes du manifeste binaire',
    fichier: 'packages/sdk-core/manifestBinaryLayout.ts',
    cas,
    reference: passe(referenceWriteSha),
    optimisee: passe(writeSha),
    options: { tours: 200, budgetMs: 2500 },
  }),
];

verifieEtDeposeF(
  'f-manifeste',
  'F19 écrit exactement les mêmes octets et refuse exactement les mêmes empreintes',
  lignes,
);
