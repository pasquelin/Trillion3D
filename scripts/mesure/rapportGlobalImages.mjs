// Les captures du rapport : chaque PNG de la campagne est converti une fois en JPEG (qualité 90,
// `sips` de macOS) sous `vignettes/` à côté du rapport, et la page y renvoie par chemin relatif.
// Rien n'est incrusté dans la page : dix paires d'images pleine taille la feraient peser 30 Mo.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Le chemin relatif au rapport de la capture `chemin` en JPEG, ou `null` si elle manque. */
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
