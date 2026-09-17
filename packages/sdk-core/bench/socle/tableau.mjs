// Le rendu d'une ligne de mesure, écrit une fois. La console d'un banc et le tableau agrégé
// composent les mêmes cellules dans le même ordre : ils ne peuvent plus afficher deux formats du
// même chiffre. Seules les pastilles de régression distinguent les deux sorties.
import { niveauEcart } from './baseline.mjs';

const ms = (v) => (v === null ? 'null' : v.toFixed(3));
const ns = (v) => (v === null ? '—' : v.toFixed(1));

const COLONNES = [
  'Médiane (ms)',
  'P95 (ms)',
  'ns/élément',
  'Ops/s',
  'vs baseline',
  'Oracle',
  'Note',
];

/** L'en-tête et son séparateur, précédés des colonnes que l'appelant ajoute à gauche. */
export function entete(avant = []) {
  const noms = [...avant, ...COLONNES];
  return [`| ${noms.join(' | ')} |`, `|${noms.map(() => '---').join('|')}|`];
}

function ecartTexte(v, pastilles) {
  const niveau = niveauEcart(v);
  if (niveau === 'absent') return '—';
  const pct = `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} %`;
  if (!pastilles) return pct;
  if (niveau === 'echec') return `🔴 ${pct}`;
  if (niveau === 'avertissement') return `⚠️ ${pct}`;
  return pct;
}

/** Une ligne du tableau. `avant` porte les colonnes de gauche (domaine, mesure) de l'agrégat. */
export function ligneMd(r, { avant = [], pastilles = false } = {}) {
  const cellules = [
    ms(r.medianeMs),
    ms(r.p95Ms),
    ns(r.nsParElement),
    r.opsParSec ?? 'null',
    ecartTexte(r.ecartBaseline, pastilles),
    r.correct === null ? '—' : r.correct ? '✓' : '✗',
    r.motif ?? '',
  ];
  return `| ${[...avant, r.nom, ...cellules].join(' | ')} |`;
}
