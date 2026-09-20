// Report captures: each campaign PNG is converted once to JPEG (quality 90, macOS `sips`) under
// `vignettes/` next to the report, and the page points there by relative path.
// Nothing is inlined in the page: ten full-size image pairs would make it weigh 30 MB.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Relative path to the report for capture `chemin` in JPEG, or `null` if missing. */
export function capture(dossier, chemin) {
  if (!chemin || !existsSync(join(dossier, chemin))) return null;
  const relatif = join('vignettes', chemin.replaceAll('/', '__').replace(/\.png$/, '.jpg'));
  const cible = join(dossier, relatif);
  mkdirSync(join(dossier, 'vignettes'), { recursive: true });
  if (!existsSync(cible))
    execFileSync(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', join(dossier, chemin), '--out', cible],
      { stdio: 'ignore' },
    );
  return relatif;
}
