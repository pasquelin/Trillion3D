// Le dépôt s'installe avec pnpm, et avec lui seul.
//
// Rien n'empêchait `npm install` : il posait un `package-lock.json` et un `node_modules` à plat, à
// côté de celui de pnpm, et les deux divergeaient en silence. Ce garde-fou le refuse à l'installation
// plutôt que de laisser la divergence se découvrir en intégration continue — ou pire, sur un verdict
// de mesure rendu avec d'autres versions que celles du verrou.
//
// `npm_config_user_agent` est posé par tout gestionnaire qui lance un script de cycle de vie ; il
// commence par son nom. Absent, personne ne nous a lancés depuis une installation : on laisse faire.
const agent = process.env.npm_config_user_agent ?? '';
if (agent && !agent.startsWith('pnpm')) {
  const nom = agent.split('/')[0];
  console.error(
    `\nCe dépôt s'installe avec pnpm, pas avec ${nom}.\n` +
      `  corepack enable && pnpm install\n\n` +
      `Le verrou suivi est pnpm-lock.yaml ; il n'y a pas de package-lock.json, et la version du\n` +
      `gestionnaire est fixée par le champ "packageManager" de package.json.\n`,
  );
  process.exit(1);
}
