import type { CompilerEvent } from '../compiler/contracts.ts';
import {
  docsOf,
  messageOf,
  type CatalogueMessage,
  type MessageLevel,
} from '../messages/catalogue.mts';

/** The primitive with the most roots among a code's DAG warnings. */
interface Worst {
  where: string;
  roots: number;
  pages: number;
}
/** One code's occurrences in a job. */
interface Counted {
  entry: CatalogueMessage;
  count: number;
  worst?: Worst;
  occurrences: string[];
}
type Counts = Record<string, unknown> | null | undefined;
const MARK: Record<MessageLevel, string> = { error: '✖', warn: '⚠', info: 'ℹ' };

/**
 * The messages of one job, counted while it compiles and told once at its end: one line per code —
 * how many, the worst case, what to do — never one line per primitive. It reads the primitives' DAG
 * warnings, the import report on the `import` event, the lights left out on the `lights` event, and
 * the pointer's texture reasons and unsupported modes. Keys the catalogue does not know are counts
 * of something else and are left out. `verbose` adds the info codes and keeps every occurrence;
 * otherwise only the counts and the worst case are kept.
 */
export function messageTally(verbose = false) {
  const counted = new Map<string, Counted>();
  const add = (code: string, count: number, occurrence: () => string) => {
    const entry = messageOf(code);
    if (!entry || count <= 0) return undefined;
    const row = counted.get(entry.code) ?? { entry, count: 0, occurrences: [] };
    counted.set(entry.code, row);
    row.count += count;
    if (verbose) row.occurrences.push(occurrence());
    return row;
  };
  const addCounts = (counts: Counts) => {
    if (!counts || typeof counts !== 'object') return;
    for (const [code, count] of Object.entries(counts))
      if (typeof count === 'number') add(code, count, () => `${code} ×${count}`);
  };
  const shown = () =>
    [...counted.values()]
      .filter((row) => verbose || row.entry.level !== 'info')
      .sort((a, b) => b.count - a.count || a.entry.id.localeCompare(b.entry.id));
  return {
    /** Feeds one compiler event. */
    record(event: CompilerEvent) {
      for (const warning of event.warnings ?? []) {
        const where = `mesh ${event.mesh}/${event.primitive}`;
        const cause = warning.cause ? ` (cause ${warning.cause})` : '';
        const row = add(
          warning.code,
          1,
          () => `${warning.code} ${where}: ${warning.roots} roots of ${warning.pages} pages${cause}`,
        );
        if (row && (!row.worst || warning.roots > row.worst.roots))
          row.worst = { where, roots: warning.roots, pages: warning.pages };
      }
      if (event.phase === 'import') addCounts(event.unsupported as Counts);
      if (event.phase === 'lights') {
        addCounts(event.rejected as Counts);
        addCounts(event.counts as Counts);
      }
      const pointer = event.event === 'complete' ? (event.pointer as Counts) : null;
      if (!pointer) return;
      addCounts(pointer.textureSkipped as Counts);
      addCounts(pointer.textureNotes as Counts);
      const modes = Array.isArray(pointer.unsupported) ? (pointer.unsupported as unknown[]) : [];
      for (const mode of modes) if (typeof mode === 'string') add(mode, 1, () => mode);
    },
    /** Warning-level occurrences: what `--strict` refuses. */
    get warnings() {
      return [...counted.values()]
        .filter((row) => row.entry.level === 'warn')
        .reduce((sum, row) => sum + row.count, 0);
    },
    /** One line per code; info codes only when `verbose`, which also lists every occurrence. */
    lines(label: string) {
      return shown().flatMap(({ entry, count, worst, occurrences }) => {
        const worstText = worst
          ? ` Worst: ${worst.where}, ${worst.roots} roots of ${worst.pages} pages.`
          : '';
        const head =
          `${MARK[entry.level]} ${label} ${entry.id} ${entry.code} ×${count}: ${entry.message}` +
          `${worstText} ${entry.action} ${docsOf(entry)}`;
        return verbose ? [head, ...occurrences.map((text) => `    ${text}`)] : [head];
      });
    },
    /** The same summary as JSON events, for a pipe. */
    events(job: string) {
      return shown().map(({ entry, count, worst, occurrences }) => ({
        event: 'message',
        job,
        ...entry,
        count,
        docs: docsOf(entry),
        ...(worst && { worst }),
        ...(verbose && { occurrences }),
      }));
    },
  };
}
