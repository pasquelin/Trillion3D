#!/usr/bin/env node
// Copies the campaign report into `docs/` for GitHub Pages (branch + /docs folder), next to
// the documentation portal that `docs/index.html` serves.
//
//   node scripts/mesure/rapportGlobal.mjs
//   node scripts/mesure/publierRapport.mjs
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from './options.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

/** The page the report is published as; `index.html` belongs to the documentation portal. */
const REPORT_PAGE = 'report.html';

/**
 * Places `rapport.html` as the Pages folder's `report.html`, copies the thumbnails, and disables
 * Jekyll (`.nojekyll`) so GitHub serves the HTML as-is.
 */
export function publierRapport(source, dest) {
  const rapport = join(source, 'rapport.html');
  if (!existsSync(rapport)) throw new Error(`no report: ${rapport}`);
  mkdirSync(dest, { recursive: true });
  cpSync(rapport, join(dest, REPORT_PAGE));
  const vignettes = join(source, 'vignettes');
  const destVignettes = join(dest, 'vignettes');
  rmSync(destVignettes, { recursive: true, force: true });
  if (existsSync(vignettes)) cpSync(vignettes, destVignettes, { recursive: true });
  writeFileSync(join(dest, '.nojekyll'), '');
  return join(dest, REPORT_PAGE);
}

if (import.meta.filename === process.argv[1]) {
  const flags = parseArgs(process.argv.slice(2));
  const source = resolve(flags.get('dossier') ?? join(ROOT, '.mesure/out/global'));
  const dest = resolve(flags.get('vers') ?? join(ROOT, 'docs'));
  console.log(`Pages: ${publierRapport(source, dest)}`);
}
