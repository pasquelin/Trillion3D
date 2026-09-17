// La partie performance du banc M5, dans un processus Node NEUF : la partie équivalence appelle les
// deux chemins avec toutes sortes d'entrées et V8 en garde la trace dans ses sites d'appel, ce qui
// fausserait le chronomètre (`sdk-core/bench/bancProcessusNeuf.mjs` le dit en entier).
//
// Rien n'est déduit : le temps est celui de `process.hrtime.bigint()` autour du lot seul, la valeur
// citée est la médiane des répétitions, et l'en-tête porte de quoi récuser les chiffres — machine,
// charge, temps depuis le démarrage.
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { RACINE } from '../../sdk-core/bench/mesure.mjs';
import { prepareMathBatch } from '../mathBatchState.ts';
import { TAILLES } from './m5Cas.mjs';

/** Mode court : de quoi vérifier que le script tourne, jamais une mesure. */
const COURT = process.env.M5_COURT === '1';
const REGLAGES = COURT ? { chauffe: 2, repetitions: 3 } : { chauffe: 10, repetitions: 31 };

/** Médiane d'une série. */
function mediane(serie) {
  const triee = serie.slice().sort((a, b) => a - b);
  const milieu = triee.length >> 1;
  return triee.length % 2 ? triee[milieu] : (triee[milieu - 1] + triee[milieu]) / 2;
}

/**
 * Nanosecondes par élément d'un chemin imposé. Les deux chemins alternent chez l'appelant, si bien
 * que la dérive de la machine touche les deux également.
 */
async function nsParElement(lot, chemin, n) {
  await prepareMathBatch(chemin);
  for (let i = 0; i < REGLAGES.chauffe; i++) lot.run();
  const durees = [];
  for (let r = 0; r < REGLAGES.repetitions; r++) {
    globalThis.gc?.();
    const debut = process.hrtime.bigint();
    const joue = lot.run();
    const ns = Number(process.hrtime.bigint() - debut);
    if (joue !== chemin) throw new Error(`M5 : chemin ${joue} joué alors que ${chemin} est imposé`);
    durees.push(ns / n);
  }
  return mediane(durees);
}

/** Une ligne du tableau : les deux chemins sur le même lot, en alternance. */
async function ligne(operation, n, cree, remplit) {
  const lot = await cree(n);
  remplit(lot, n);
  const js = [],
    wasm = [];
  for (let tour = 0; tour < 2; tour++) {
    if (tour % 2 === 0) {
      js.push(await nsParElement(lot, 'js', n));
      wasm.push(await nsParElement(lot, 'wasm', n));
    } else {
      wasm.push(await nsParElement(lot, 'wasm', n));
      js.push(await nsParElement(lot, 'js', n));
    }
  }
  lot.release();
  const jsNs = mediane(js),
    wasmNs = mediane(wasm);
  return { operation, n, partage: lot.shared, jsNs, wasmNs, rapport: wasmNs / jsNs };
}

/** Le commit mesuré, ou `null` hors d'un dépôt. */
function commit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const f = (v) => (v === null || v === undefined ? 'null' : v.toFixed(2));

/** Joue toutes les lignes et imprime le tableau. */
export async function mesurePerformance(lots) {
  const lignes = [];
  for (const { operation, cree, remplit } of lots)
    for (const n of TAILLES) lignes.push(await ligne(operation, n, cree, remplit));
  const cpus = os.cpus();
  console.log(
    [
      '',
      `M5 — calcul en lot, JavaScript contre WebAssembly — ${COURT ? 'court (pas une mesure)' : 'complet'}`,
      `Node ${process.version} · ${cpus[0]?.model ?? 'inconnu'} × ${cpus.length} · charge ${os
        .loadavg()
        .map((c) => c.toFixed(2))
        .join(' / ')} · uptime ${Math.round(os.uptime())} s · commit ${commit()}`,
      `répétitions ${REGLAGES.repetitions}, chauffe ${REGLAGES.chauffe}`,
      '',
      '| opération | n | tampon partagé | JS ns/élément | Wasm ns/élément | Wasm / JS |',
      '| --- | --- | --- | --- | --- | --- |',
      ...lignes.map(
        (l) =>
          `| ${l.operation} | ${l.n} | ${l.partage ? 'oui' : 'non'} | ${f(l.jsNs)} | ${f(
            l.wasmNs,
          )} | ${f(l.rapport)} |`,
      ),
    ].join('\n'),
  );
  return lignes;
}
