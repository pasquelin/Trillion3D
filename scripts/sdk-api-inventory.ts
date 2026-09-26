import {
  analyzeEntries,
  consumerImports,
  ENTRIES,
  type ExportEntry,
  type ExportRow,
} from './sdk-api-model.ts';
import { DOCUMENTED_GAPS } from './sdk-api-documented.ts';

function classification(row: ExportRow): string {
  return /\/math\/oracles\.ts$|competitors|compareImages|experiment[A-Z]|screenErrorVariant/.test(
    row.module,
  )
    ? 'experimental'
    : 'public';
}

function environments(row: ExportRow): string {
  if (row.entries.includes('core')) return 'common, browser, node, worker';
  if (row.entries.includes('browser')) return 'browser';
  return 'node';
}

const entryLabel: Record<ExportEntry, string> = {
  core: 'trillion3d (common)',
  browser: 'trillion3d (browser condition)',
  node: 'trillion3d (node condition)',
};

interface InventoryEntry {
  name: string;
  kind: ExportRow['kind'];
  definingModule: string;
  currentEntryPoints: string[];
  proposedEnvironments: string;
  classification: string;
  affectedConsumers: string[];
  disposition: string;
  bindingIdentity: string;
}

/** The export inventory of `site/data/api-inventory.json`: every export of the three entries and
 *  of the documented gaps, where it is defined, which entry points bind it and who imports it. */
export function apiInventory() {
  const rows = [...analyzeEntries(), ...DOCUMENTED_GAPS];
  const consumers = consumerImports();
  const inventory: InventoryEntry[] = rows.map((row) => ({
    name: row.name,
    kind: row.kind,
    definingModule: row.module,
    currentEntryPoints: row.entries.map((entry) => entryLabel[entry]),
    proposedEnvironments: environments(row),
    classification: classification(row),
    affectedConsumers: [...(consumers.get(row.name) ?? []), ...(row.consumers ?? [])].sort(),
    disposition: row.disposition ?? 'retained',
    bindingIdentity: row.identity,
  }));
  // `Object.groupBy` needs lib ES2024, beyond the tools' configured lib: grouped by hand instead,
  // in the same first-seen order.
  const grouped = new Map<string, InventoryEntry[]>();
  for (const entry of inventory) {
    const group = grouped.get(entry.name) ?? [];
    group.push(entry);
    grouped.set(entry.name, group);
  }
  // A name bound twice is a collision, unless one binding is a page word of the world families
  // (`packages/*/world/`) and the other an engine contract of the common entry: the browser
  // facade names the page word explicitly, and an explicit export shadows the common one there.
  // Those are listed apart, so the shadowing is a decision the inventory states, not an accident.
  const collisions: { name: string; bindings: string[] }[] = [],
    shadowed: { name: string; bindings: string[] }[] = [];
  for (const [name, entries] of grouped) {
    const bindings = entries.map((entry) => entry.bindingIdentity);
    if (new Set(bindings).size < 2) continue;
    const words = entries.filter((entry) => entry.definingModule.includes('/world/'));
    const pageWord =
      entries.length === 2 &&
      words.length === 1 &&
      entries.some((entry) => entry.currentEntryPoints.includes(entryLabel.core));
    (pageWord ? shadowed : collisions).push({ name, bindings });
  }
  return { generatedFrom: ENTRIES, collisions, shadowed, exports: inventory };
}
