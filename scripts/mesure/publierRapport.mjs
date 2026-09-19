#!/usr/bin/env node
// Copie le rapport de campagne dans `docs/` pour GitHub Pages (branche + dossier /docs).
//
//   node scripts/mesure/rapportGlobal.mjs
//   node scripts/mesure/publierRapport.mjs
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from './options.mjs';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * Pose `rapport.html` en `index.html` du dossier Pages, recopie les vignettes, et désactive Jekyll
 * (`.nojekyll`) pour que GitHub serve le HTML tel quel.
 */
export function publierRapport(source, dest) {
  const rapport = join(source, 'rapport.html');
  if (!existsSync(rapport)) throw new Error(`pas de rapport : ${rapport}`);
  mkdirSync(dest, { recursive: true });
  cpSync(rapport, join(dest, 'index.html'));
  const vignettes = join(source, 'vignettes');
  const destVignettes = join(dest, 'vignettes');
  rmSync(destVignettes, { recursive: true, force: true });
  if (existsSync(vignettes)) cpSync(vignettes, destVignettes, { recursive: true });
  writeFileSync(join(dest, '.nojekyll'), '');
  return join(dest, 'index.html');
}

if (import.meta.filename === process.argv[1]) {
  const flags = parseArgs(process.argv.slice(2));
  const source = resolve(flags.get('dossier') ?? join(ROOT, '.mesure/out/global'));
  const dest = resolve(flags.get('vers') ?? join(ROOT, 'docs'));
  console.log(`Pages : ${publierRapport(source, dest)}`);
}
