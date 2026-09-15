// Chronomètre du banc de performance des volumes (lot M2) : nanosecondes par opération et octets
// alloués par opération, Three.js et sdk-core alternés à chaque répétition pour que la dérive d'une
// machine chargée touche les deux côtés, médiane et p95 sur toutes les répétitions après chauffe.
import { execFileSync } from 'node:child_process';
import { cpus, loadavg } from 'node:os';

const collecte = globalThis.gc;

/** Une répétition d'un côté : durée par opération, et octets de tas gagnés par opération. Le tas est
 *  collecté avant, jamais pendant ; une collecte spontanée au milieu peut rendre un solde négatif,
 *  il est gardé tel quel. Sans `--expose-gc`, les octets valent `null`. */
function repetition(tour, operations, durees, octets) {
  if (collecte) collecte();
  const avant = process.memoryUsage().heapUsed;
  const debut = process.hrtime.bigint();
  tour();
  const ns = Number(process.hrtime.bigint() - debut);
  const apres = process.memoryUsage().heapUsed;
  durees.push(ns / operations);
  octets.push(collecte ? (apres - avant) / operations : null);
}

/** Médiane et p95 (rang le plus proche) d'une série ; `null` si la série n'a que des `null`. */
function resume(serie) {
  const valeurs = serie.filter((v) => v !== null).sort((a, b) => a - b);
  if (!valeurs.length) return { mediane: null, p95: null };
  const milieu = valeurs.length >> 1;
  return {
    mediane: valeurs.length % 2 ? valeurs[milieu] : (valeurs[milieu - 1] + valeurs[milieu]) / 2,
    p95: valeurs[Math.min(valeurs.length - 1, Math.ceil(valeurs.length * 0.95) - 1)],
  };
}

/** Mesure une ligne : chauffe, puis `repetitions` passages alternés, puis la vérification que les
 *  deux côtés ont rendu les mêmes bits sur ce travail. */
export function mesureLigne(ligne, repetitions, chauffe) {
  for (let i = 0; i < chauffe; i++) {
    ligne.three();
    ligne.nous();
  }
  const three = { ns: [], octets: [] },
    nous = { ns: [], octets: [] };
  for (let r = 0; r < repetitions; r++) {
    const ordre = r % 2 ? [nous, three] : [three, nous];
    for (const cote of ordre)
      repetition(cote === three ? ligne.three : ligne.nous, ligne.operations, cote.ns, cote.octets);
  }
  const ecart = ligne.verifie();
  if (ecart) throw new Error(`${ligne.nom} (${ligne.taille}) : ${ecart}`);
  const t = { ns: resume(three.ns), octets: resume(three.octets) },
    n = { ns: resume(nous.ns), octets: resume(nous.octets) };
  return {
    famille: ligne.famille,
    nom: ligne.nom,
    taille: ligne.taille,
    operationsParRepetition: ligne.operations,
    repetitions,
    three: t,
    nous: n,
    rapportThreeSurNous: t.ns.mediane / n.ns.mediane,
  };
}

/** L'en-tête d'une campagne : ce qu'il faut pour relire un chiffre sans le deviner. */
export function enTete(repetitions, chauffe) {
  let commit = null,
    modifie = null;
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    modifie = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
  } catch {
    // Hors dépôt : le commit reste inconnu, et le dit.
  }
  const processeurs = cpus();
  return {
    date: new Date().toISOString(),
    node: process.version,
    cpu: processeurs[0]?.model ?? null,
    coeurs: processeurs.length,
    chargeSysteme: loadavg(),
    commit,
    arbreModifie: modifie,
    exposeGc: !!collecte,
    repetitions,
    chauffe,
  };
}

const ns = (v) => (v === null ? 'null' : v.toFixed(2));
const oct = (v) => (v === null ? 'null' : v.toFixed(3));

/** Le tableau lisible en console : une ligne par mesure, Three puis nous, puis le rapport. */
export function tableau(entete, lignes) {
  const sortie = [
    `Node ${entete.node} · ${entete.cpu} ×${entete.coeurs} · charge ${entete.chargeSysteme
      .map((v) => v.toFixed(2))
      .join(' ')} · commit ${entete.commit ?? 'inconnu'}${entete.arbreModifie ? ' (modifié)' : ''}`,
    `${entete.repetitions} répétitions après ${entete.chauffe} de chauffe · --expose-gc ${
      entete.exposeGc ? 'oui' : 'non'
    }`,
    '| famille | calcul | taille | Three ns/op (méd · p95) | nous ns/op (méd · p95) | Three / nous | octets/op Three | octets/op nous |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const l of lignes)
    sortie.push(
      `| ${l.famille} | ${l.nom} | ${l.taille} | ${ns(l.three.ns.mediane)} · ${ns(l.three.ns.p95)} | ${ns(
        l.nous.ns.mediane,
      )} · ${ns(l.nous.ns.p95)} | ${l.rapportThreeSurNous.toFixed(2)}${
        l.rapportThreeSurNous < 1 ? ' (plus lent)' : ''
      } | ${oct(l.three.octets.mediane)} | ${oct(l.nous.octets.mediane)} |`,
    );
  return sortie.join('\n');
}
