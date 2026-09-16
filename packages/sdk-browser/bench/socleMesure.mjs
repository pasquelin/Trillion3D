// Le chronomètre du banc de performance du socle : même travail des deux côtés, en alternance, et
// pour chaque ligne le temps par opération et les octets retenus par opération, médiane et p95.
// Rien n'est déduit : une valeur que la machine ne donne pas (ramasse-miettes non exposé) vaut `null`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';
import { RACINE } from '../../sdk-core/bench/banc.mjs';

/** Le ramasse-miettes, exposé à la volée quand Node n'a pas reçu `--expose-gc`. */
function ramasseMiettes() {
  if (typeof globalThis.gc === 'function') return globalThis.gc;
  try {
    v8.setFlagsFromString('--expose-gc');
    const gc = vm.runInNewContext('gc');
    return typeof gc === 'function' ? gc : null;
  } catch {
    return null;
  }
}
const gc = ramasseMiettes();

/** Mode court : quelques répétitions, pour vérifier que le script tourne ; jamais une mesure. */
const COURT = process.env.SOCLE_COURT === '1';
export const REGLAGES = COURT
  ? { chauffe: 1, repetitions: 3, operationsSeules: 2_000 }
  : { chauffe: 5, repetitions: 20, operationsSeules: 20_000 };

/** Médiane et 95e centile d'une série ; `null` pour une série vide ou non mesurée. */
function quantiles(serie) {
  if (!serie.length || serie.some((v) => v === null)) return { mediane: null, p95: null };
  const triee = serie.slice().sort((a, b) => a - b);
  const rang = (q) => triee[Math.min(triee.length - 1, Math.ceil(q * triee.length) - 1)];
  const milieu = triee.length >> 1;
  const mediane = triee.length % 2 ? triee[milieu] : (triee[milieu - 1] + triee[milieu]) / 2;
  return { mediane, p95: rang(0.95) };
}

/** Une répétition : collecte, tas avant, travail, tas après. Octets par opération ou `null`. */
function repetition(travail, operations) {
  gc?.();
  const tas = process.memoryUsage().heapUsed,
    debut = process.hrtime.bigint();
  travail();
  const ns = Number(process.hrtime.bigint() - debut);
  const octets = gc ? (process.memoryUsage().heapUsed - tas) / operations : null;
  return { nsParOp: ns / operations, octetsParOp: octets };
}

/**
 * Une ligne du tableau. `three` et `socle` font le même travail sur les mêmes entrées préparées ;
 * `operations` est le nombre d'opérations d'un passage. Les deux côtés alternent, l'ordre
 * s'inversant à chaque répétition, pour que la dérive de la machine touche les deux également.
 */
export function mesure({ ligne, charge, operations, three, socle }) {
  for (let i = 0; i < REGLAGES.chauffe; i++) {
    three();
    socle();
  }
  const cotes = { three: [], socle: [] };
  for (let r = 0; r < REGLAGES.repetitions; r++) {
    const ordre = r % 2 ? ['socle', 'three'] : ['three', 'socle'];
    for (const cote of ordre)
      cotes[cote].push(repetition(cote === 'three' ? three : socle, operations));
  }
  const resume = (serie) => ({
    nsParOp: quantiles(serie.map((s) => s.nsParOp)),
    octetsParOp: quantiles(serie.map((s) => s.octetsParOp)),
  });
  const t = resume(cotes.three),
    s = resume(cotes.socle);
  return {
    ligne,
    charge,
    operations,
    repetitions: REGLAGES.repetitions,
    three: t,
    socle: s,
    rapport: t.nsParOp.mediane > 0 ? s.nsParOp.mediane / t.nsParOp.mediane : null,
  };
}

/** Le commit mesuré, ou `null` hors d'un dépôt. */
function commitCourant() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** L'en-tête de la campagne : ce qui permet de rejouer ou de récuser les chiffres. */
export function entete() {
  const cpus = os.cpus();
  return {
    date: new Date().toISOString(),
    node: process.version,
    cpu: cpus[0]?.model ?? null,
    coeurs: cpus.length,
    chargeSysteme: os.loadavg(),
    commit: commitCourant(),
    mode: COURT ? 'court (vérification du script, pas une mesure)' : 'complet',
    reglages: REGLAGES,
    ramasseMiettesExpose: gc !== null,
  };
}

const f = (v, chiffres = 1) => (v === null ? 'null' : v.toFixed(chiffres));

/** Le tableau lisible, écrit en console et dans `.mesure/out/calculs/` à côté du JSON. */
export function publie(tete, lignes) {
  const texte = [
    `Socle mathématique contre la référence — ${tete.mode}`,
    `Node ${tete.node} · ${tete.cpu} × ${tete.coeurs} · charge ${tete.chargeSysteme.map((c) => c.toFixed(2)).join(' / ')} · commit ${tete.commit}`,
    '',
    '| ligne | charge | Three ns/op méd (p95) | socle ns/op méd (p95) | socle / Three | octets/op Three | octets/op socle |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...lignes.map(
      (l) =>
        `| ${l.ligne} | ${l.charge} | ${f(l.three.nsParOp.mediane)} (${f(l.three.nsParOp.p95)}) | ${f(l.socle.nsParOp.mediane)} (${f(l.socle.nsParOp.p95)}) | ${f(l.rapport, 3)} | ${f(l.three.octetsParOp.mediane, 2)} | ${f(l.socle.octetsParOp.mediane, 2)} |`,
    ),
  ].join('\n');
  const dossier = join(RACINE, '.mesure', 'out', 'calculs');
  const nom = COURT ? 'socle-math-court' : `socle-math-${tete.date.slice(0, 10)}`;
  mkdirSync(dossier, { recursive: true });
  writeFileSync(
    join(dossier, `${nom}.json`),
    `${JSON.stringify({ entete: tete, lignes }, null, 2)}\n`,
  );
  writeFileSync(join(dossier, `${nom}.md`), `${texte}\n`);
  console.log(`\n${texte}\nJSON et tableau : ${join(dossier, nom)}.{json,md}`);
}
