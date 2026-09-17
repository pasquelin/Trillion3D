// Le dépôt s'installe avec pnpm, et avec lui seul.
//
// Rien n'empêchait `npm install` : il posait un `package-lock.json` et un `node_modules` à plat, à
// côté de celui de pnpm, et les deux divergeaient en silence. Ce garde-fou le refuse à l'installation
// plutôt que de laisser la divergence se découvrir en intégration continue — ou pire, sur un verdict
// de mesure rendu avec d'autres versions que celles du verrou.
//
// `npm_config_user_agent` est posé par tout gestionnaire qui lance un script de cycle de vie ; il
// commence par son nom. Absent, personne ne nous a lancés depuis une installation : on laisse faire.
import { pathToFileURL } from 'node:url';
//
// Le garde-fou ne tourne QUE lorsque ce fichier est le programme lancé (`preinstall`) : les scripts
// du dépôt l'importent pour `commandePnpm`, et un import ne doit pas décider de leur sort.
const agent = process.env.npm_config_user_agent ?? '';
const lance = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (lance && agent && !agent.startsWith('pnpm')) {
  const nom = agent.split('/')[0];
  console.error(
    `\nCe dépôt s'installe avec pnpm, pas avec ${nom}.\n` +
      `  corepack enable && pnpm install\n\n` +
      `Le verrou suivi est pnpm-lock.yaml ; il n'y a pas de package-lock.json, et la version du\n` +
      `gestionnaire est fixée par le champ "packageManager" de package.json.\n`,
  );
  process.exit(1);
}

/** La commande qui relance le gestionnaire du dépôt. `npm_execpath` est le chemin du gestionnaire
 *  qui nous a lancés : l'exécuter avec le Node courant évite le cas `pnpm.cmd` de Windows, où un
 *  script sans extension ne s'exécute pas — et garantit que c'est bien le gestionnaire qui a posé
 *  `node_modules` qui construit. Hors script de cycle de vie, on nomme `pnpm` et on s'en remet au
 *  PATH. Exporté ici parce que ce fichier est déjà celui qui dit quel gestionnaire le dépôt veut. */
export function commandePnpm(...args) {
  const execpath = process.env.npm_execpath;
  if (execpath) return [process.execPath, [execpath, ...args]];
  return [process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args];
}
