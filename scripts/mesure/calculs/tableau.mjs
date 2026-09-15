// Partie commune aux agrégateurs : racine du dépôt, lecture des fragments déposés par les bancs,
// provenance du lot mesuré et écriture du couple Markdown / JSON. Les bancs et leurs oracles vivent
// dans le paquet mesuré (`packages/*/bench/`) ; ce dossier n'importe rien d'un paquet, il ne lit que
// leurs fragments.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SORTIE = join(RACINE, '.mesure', 'out', 'calculs');

export const nombre = (v) => (v === null ? 'null' : v.toFixed(3));
export const pourcent = (v) => (v === null ? 'null' : `${(v * 100).toFixed(1)} %`);

/** Le commit mesuré, ou `null` : une mesure sans provenance n'en est pas une. */
function commit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Les fragments déposés par les fichiers de banc d'un lot, remis dans l'ordre des points. */
export function lisFragments(dossier) {
  const chemin = join(RACINE, '.mesure', dossier);
  return readdirSync(chemin)
    .filter((nom) => nom.endsWith('.json'))
    .flatMap((nom) => JSON.parse(readFileSync(join(chemin, nom), 'utf8')))
    .sort((a, b) => Number(a.calcul.slice(1, 3).trim()) - Number(b.calcul.slice(1, 3).trim()));
}

/** Au-delà de cette charge moyenne, les chronomètres ne départagent plus rien d'honnête. */
const CHARGE_MAX = 4;

/** Un commit, ou `null` : une mesure sans provenance n'en est pas une. */
function sha(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Provenance et état de la machine d'un lot mesuré sur sa branche : la base du lot, `develop` au
 *  moment de la mesure, la charge. `explication` est la phrase propre au lot, elle suit la ligne de
 *  provenance ; la charge, si elle dépasse le seuil, ajoute la sienne à la fin. Rendu tel quel dans
 *  `extra`, sauf `note`, qui va au paramètre du même nom. */
export function contexteLot(explication) {
  const charge = loadavg()[0];
  const develop = sha('rev-parse', 'develop');
  const socle = sha('merge-base', 'HEAD', 'develop');
  const lignes = [
    socle
      ? `Base du lot : \`${socle}\` ; \`develop\` au moment de la mesure : \`${develop}\`.`
      : null,
    explication,
  ];
  if (charge > CHARGE_MAX)
    lignes.push(
      `Machine chargée pendant la mesure (charge moyenne sur une minute : ${charge.toFixed(1)}, ` +
        `seuil ${CHARGE_MAX}) : temps non concluants.`,
    );
  return {
    develop,
    socle,
    chargeMachine: charge,
    tempsConcluants: charge <= CHARGE_MAX,
    note: lignes.filter(Boolean).join('\n'),
  };
}

/** Imprime le tableau du lot puis l'écrit en Markdown et en JSON brut. Non mesuré vaut `null`. */
export function ecris({ nom, titre, preambule, entete, separateur, ligne, lignes, extra }) {
  const jour = new Date().toISOString().slice(0, 10);
  const tableau = [entete, separateur, ...lignes.map(ligne)].join('\n');
  const retenus = lignes.filter((l) => l.retenu).length;
  const resume = `${lignes.length} calculs comparés, ${retenus} retenus, ${
    lignes.filter((l) => !l.identique).length
  } écarts bit à bit.`;

  console.log(`\n${tableau}\n\n${resume}`);

  mkdirSync(SORTIE, { recursive: true });
  writeFileSync(
    join(SORTIE, `${nom}-${jour}.md`),
    `# ${titre} (${jour})\n\n` +
      `Machine : ${process.platform}/${process.arch}, Node ${process.version}. Commit \`${commit()}\`.\n` +
      `${preambule}\n` +
      `DPR, résolution d'affichage et FPS : sans objet ici, ces mesures sont des calculs CPU purs.\n\n${tableau}\n\n${resume}\n`,
  );
  writeFileSync(
    join(SORTIE, `${nom}-${jour}.json`),
    `${JSON.stringify(
      {
        version: 1,
        ...extra,
        date: new Date().toISOString(),
        commit: commit(),
        node: process.version,
        plateforme: `${process.platform}/${process.arch}`,
        dpr: null,
        fps: null,
        lignes,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nÉcrit : .mesure/out/calculs/${nom}-${jour}.md et .json`);
}

/** Le tableau des lots à égalité bit à bit — A, F et G : même en-tête, même règle de « Retenu ».
 *  `note` ajoute une phrase au préambule, par exemple l'état de la machine pendant la mesure. */
export function ecrisBitAbit({ nom, titre, extra, note }) {
  ecris({
    nom,
    titre,
    preambule:
      `Médiane sur N tours après échauffement ; « Retenu » exige l'égalité bit à bit ET un gain.` +
      (note ? `\n${note}` : ''),
    entete: '| Calcul | Fichier | Avant (ms) | Après (ms) | Gain | Identique | Retenu |',
    separateur: '|---|---|---|---|---|---|---|',
    ligne: (l) =>
      `| ${l.calcul} | \`${l.fichier}\` | ${nombre(l.avantMs)} | ${nombre(l.apresMs)} | ${pourcent(
        l.gain,
      )} | ${l.identique ? 'oui' : 'non'} | ${l.retenu ? 'oui' : 'non'} |`,
    lignes: lisFragments(nom),
    extra,
  });
}
