// Le chemin de calcul en lot, tel que le gouverneur l'a publié, pour `resume.md`.

/** Une médiane, ou « non mesuré » : un tiret ne serait pas distinct d'un zéro mesuré. */
const ns = (value) => (value == null ? 'non mesuré' : value.toFixed(1));

/** L'état du module WebAssembly d'un côté, avec la cause quand il n'est pas jouable. */
function module(releve) {
  if (!releve.wasmAvailable) return releve.unavailableReason ?? 'indisponible';
  return (
    `chargé${releve.wasmSimd ? ', simd128' : ''}` +
    (releve.clockCoarse ? ', horloge trop grossière pour arbitrer' : '')
  );
}

/**
 * Le chemin de calcul de chaque côté : ce que le gouverneur a CHOISI, opération par opération, et
 * les deux médianes qui l'ont décidé. Une campagne `--chemin-math js|wasm` y relit son mode imposé,
 * `auto` y relit l'arbitrage. Rien n'est déduit : un côté sans relevé le dit, un côté qui n'a joué
 * aucun lot le dit aussi.
 */
export function cheminsCalcul(report) {
  const lines = [
    '| vue | pixelError | côté | mode | module | opération | chemin | js ns/élt | wasm ns/élt | bascules | éléments |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const serie of report.series)
    for (const [side, resultat] of Object.entries(serie.sides)) {
      const releve = resultat.cheminCalcul;
      const tete = `| ${serie.view} | ${serie.pixelError} | ${side} `;
      if (!releve) {
        lines.push(`${tete}| — | relevé absent de ce dist | — | — | — | — | — | — |`);
        continue;
      }
      const etat = `| ${releve.mode} | ${module(releve)} `;
      const operations = Object.entries(releve.operations ?? {});
      if (!operations.length) {
        lines.push(`${tete}${etat}| aucun lot joué | — | — | — | — | — |`);
        continue;
      }
      for (const [nom, o] of operations)
        lines.push(
          `${tete}${etat}| ${nom} | ${o.path ?? '—'} | ${ns(o.jsNsPerElement)} ` +
            `| ${ns(o.wasmNsPerElement)} | ${o.switches} | ${o.elements} |`,
        );
    }
  return lines;
}
