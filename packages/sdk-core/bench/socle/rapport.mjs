// Le rendu d'un banc : la garde des chemins cités, l'assertion d'exactitude, la comparaison à la
// baseline du domaine, le fragment déposé dans `.mesure/perf/` et la ligne affichée en console.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chargeBaseline, cleDeLigne } from './baseline.mjs';
import { FRAGMENTS, RACINE, cheminFragment } from './chemins.mjs';
import { ligneMd } from './tableau.mjs';

/** Les chemins mesurés doivent exister : une ligne qui cite un fichier mort ne mesure plus rien. */
function verifieFichiers(mesures) {
  for (const m of mesures)
    for (const chemin of [].concat(m.fichier ?? []))
      if (!existsSync(join(RACINE, chemin)))
        throw new Error(`Banc ${m.nom} : le fichier mesuré « ${chemin} » n'existe pas`);
}

/**
 * Les lignes du domaine, chacune augmentée de son écart à la baseline. La clé est le couple
 * mesure/cas : deux bancs qui touchent le même fichier source ne s'écrasent plus. Rien n'est muté —
 * ce qui part sur disque n'est pas ce que le banc tient encore en main.
 */
function confronteBaseline(domaine, mesures) {
  const baseline = chargeBaseline(domaine);
  const connus = new Map((baseline?.resultats ?? []).map((r) => [r.cle, r]));
  return mesures.map((m) => ({
    ...m,
    resultats: m.resultats.map((r) => {
      const base = connus.get(cleDeLigne(m.nom, r.nom));
      const comparable = base?.medianeMs && r.medianeMs !== null;
      return {
        ...r,
        ecartBaseline: comparable ? (r.medianeMs - base.medianeMs) / base.medianeMs : null,
      };
    }),
  }));
}

/**
 * Dépose le fragment du domaine et vérifie son intitulé sous `node:test` : une seule ligne fausse
 * fait tomber le banc.
 */
export function rapport(domaine, mesures, intitule) {
  const brutes = Array.isArray(mesures) ? mesures : [mesures];
  verifieFichiers(brutes);
  const tous = confronteBaseline(domaine, brutes);
  const lignes = tous.flatMap((m) => m.resultats);

  if (intitule)
    test(intitule, () => {
      for (const r of lignes) if (r.correct === false) assert.fail(`${r.nom} : ${r.difference}`);
    });

  mkdirSync(FRAGMENTS, { recursive: true });
  writeFileSync(
    cheminFragment(domaine),
    JSON.stringify({ version: 2, domaine, mesures: tous }, null, 2) + '\n',
  );
  for (const r of lignes) console.log(ligneMd(r));
}

/** Les fragments déposés par une exécution complète des bancs, pour leurs deux lecteurs. */
export function lisFragments() {
  try {
    return readdirSync(FRAGMENTS)
      .filter((n) => n.endsWith('.json'))
      .map((n) => JSON.parse(readFileSync(join(FRAGMENTS, n), 'utf8')))
      .filter((f) => f.version === 2);
  } catch {
    return [];
  }
}
