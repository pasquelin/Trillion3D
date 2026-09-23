// writing binary manifest digests.
import { writeSha } from '../../../packages/sdk-core/src/manifest/binaryLayout.ts';
import { graine, mesure, stress, rapport } from '../../core/index.ts';
import type { MesureCas } from '../../core/index.ts';
import { referenceWriteSha } from '../../oracles/core/binary-manifest.ts';

const alea = graine(211);
const HEX = '0123456789abcdef';
const empreinte = () => {
  let output = '';
  for (let i = 0; i < 64; i++) output += HEX[Math.floor(alea() * 16)];
  return output;
};

const PAGES = 40000;
const valides: string[] = [];
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
  `${zeros}é`,
  `${zeros}\uD83D`,
];

interface Entree {
  liste: string[];
}

const passe = (fn: (target: Uint8Array, slot: number, sha: string) => void) => (input: Entree) => {
  const colonne = new Uint8Array(Math.max(1, input.liste.length) * 64).fill(0xff);
  const refus: (string | null)[] = [];
  for (let i = 0; i < input.liste.length; i++) {
    try {
      fn(colonne, i, input.liste[i]);
      refus.push(null);
    } catch (erreur) {
      refus.push(erreur instanceof Error ? erreur.message : String(erreur));
    }
  }
  return { colonne, refus };
};

const cas: MesureCas<Entree>[] = [
  { name: '40 000 valid hashes', input: { liste: valides }, size: PAGES },
  { name: 'rejected hashes', input: { liste: refusees }, size: refusees.length },
  { name: 'a single hash', input: { liste: [valides[0]] }, size: 1 },
  { name: 'no hashes', input: { liste: [] }, size: 0 },
];

const res = await mesure({
  name: 'binary manifest hashes',
  fichier: 'packages/sdk-core/src/manifest/binaryLayout.ts',
  cas,
  calcul: passe(writeSha),
  attendu: passe(referenceWriteSha),
  options: { tours: 100, budgetMs: 1500 },
});

await stress({
  name: 'writeSha extremes',
  calcul: (s: string) => {
    const col = new Uint8Array(64);
    try {
      writeSha(col, 0, s);
    } catch {
      // Expected rejections
    }
  },
  extremes: [
    { name: 'empty string', input: '' },
    { name: 'null char', input: '\0' },
    { name: 'too long', input: 'a'.repeat(200) },
  ],
});

rapport(
  'manifeste-binaire',
  [res],
  'F19 writes exactly the same bytes and rejects exactly the same hashes',
);
