// Les décalages dans `work` que `coupe-lancements-gpu.mjs` passe à sa fonction de page : calculés
// ici, côté Node, parce qu'une fonction sérialisée vers Chromium ne voit que son argument.
/**
 * Les décalages en octets des comptes de groupes dans `work`. Calculés côté Node et passés dans la
 * variante : la fonction de page traverse en texte et ne voit que son argument.
 *
 * `groupesDeFile` distingue les deux dispositions : le noyau d'avant donnait à chaque file un compte
 * de groupes, puisqu'elle était lue indirectement ; celui d'après n'en donne plus, la descente étant
 * lancée à plat. Tout ce qui suit les files se décale d'autant.
 */
export function decalages(worldCount, blockCount, files, groupesDeFile) {
  const base = worldCount * 2 + blockCount * 2;
  const queueGroups = [],
    queueReset = [];
  const pas = groupesDeFile ? 2 : 1;
  for (let q = 0; q < files; q++) {
    queueReset.push((base + 2 + q * pas) * 4);
    queueGroups.push((base + 3 + q * pas) * 4);
  }
  const cand = (base + 3 + files * pas) * 4;
  return { live: (base + 1) * 4, queueGroups, queueReset, cand, drawn: cand + 8 };
}
