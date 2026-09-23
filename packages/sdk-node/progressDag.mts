import type { DagWarning } from '../sdk-core/src/index.ts';

/** DAG warnings of a job, summarised in one line: how many per code, and the worst. */
export function dagWarningsTally() {
  const codes = new Map<string, number>();
  let worst: { name: string; roots: number; pages: number } | null = null;
  return {
    get count() {
      return [...codes.values()].reduce((a, b) => a + b, 0);
    },
    record(warning: DagWarning, name: string) {
      codes.set(warning.code, (codes.get(warning.code) ?? 0) + 1);
      if (!worst || warning.roots > worst.roots)
        worst = { name, roots: warning.roots, pages: warning.pages };
    },
    line(label: string) {
      const byCode = [...codes].map(([code, n]) => `${n} ${code}`).join(', ');
      const top = worst
        ? ` ; worst mesh ${worst.name}: ${worst.roots} roots out of ${worst.pages} pages`
        : '';
      return `⚠ ${label}: ${this.count} primitive(s) without a unique root (${byCode})${top} — detail in clusters.json`;
    },
  };
}
