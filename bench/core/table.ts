// Rendering of a measurement row, written once. Benchmark console and aggregated table
// compose the exact same cells in the same order: they can no longer display two formats of
// the same figure. Only regression icons distinguish the two outputs; the witness column has none.
import { niveauEcart } from './baseline.ts';
import type { LigneResultat } from './measureTypes.ts';

const ms = (v: number | null) => (v === null ? 'null' : v.toFixed(3));
const ns = (v: number | null) => (v === null ? '—' : v.toFixed(1));

const COLONNES = [
  'Median (ms)',
  'P95 (ms)',
  'ns/element',
  'Ops/s',
  'vs baseline',
  'vs witness',
  'Oracle',
  'Note',
];

/** Header and its separator, preceded by columns added on the left by caller. */
export function entete(before: string[] = []) {
  const names = [...before, ...COLONNES];
  return [`| ${names.join(' | ')} |`, `|${names.map(() => '---').join('|')}|`];
}

function ecartTexte(v: number | null | undefined, pastilles: boolean) {
  const niveau = niveauEcart(v);
  if (niveau === 'absent' || v === null || v === undefined) return '—';
  const pct = `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} %`;
  if (!pastilles) return pct;
  if (niveau === 'echec') return `🔴 ${pct}`;
  if (niveau === 'avertissement') return `⚠️ ${pct}`;
  return pct;
}

/** Table row. `avant` holds left columns (domain, measurement) of the aggregate. */
export function ligneMd(
  r: LigneResultat,
  { before = [], pastilles = false }: { before?: string[]; pastilles?: boolean } = {},
) {
  const cellules = [
    ms(r.medianeMs),
    ms(r.p95Ms),
    ns(r.nsParElement),
    r.opsParSec ?? 'null',
    ecartTexte(r.ecartBaseline, pastilles),
    ecartTexte(r.ecartTemoin, false),
    r.correct === null ? '—' : r.correct ? '✓' : '✗',
    r.motif ?? '',
  ];
  return `| ${[...before, r.name, ...cellules].join(' | ')} |`;
}
