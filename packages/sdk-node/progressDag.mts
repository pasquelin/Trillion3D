/** Les avertissements de DAG d'un travail, résumés en une ligne : combien par code, et le pire. */
export function dagWarningsTally() {
  const codes = new Map<string, number>();
  let worst: { name: string; roots: number; pages: number } | null = null;
  return {
    get count() {
      return [...codes.values()].reduce((a, b) => a + b, 0);
    },
    record(warning: Record<string, unknown>, name: string) {
      const code = String(warning.code);
      codes.set(code, (codes.get(code) ?? 0) + 1);
      const roots = Number(warning.roots ?? 0);
      if (!worst || roots > worst.roots) worst = { name, roots, pages: Number(warning.pages ?? 0) };
    },
    line(label: string) {
      const byCode = [...codes].map(([code, n]) => `${n} ${code}`).join(', ');
      const top = worst
        ? ` ; pire mesh ${worst.name} : ${worst.roots} racines sur ${worst.pages} pages`
        : '';
      return `⚠ ${label} : ${this.count} primitive(s) sans racine unique (${byCode})${top} — détail dans clusters.json`;
    },
  };
}
