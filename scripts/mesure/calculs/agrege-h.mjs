#!/usr/bin/env node
// Assemble les fragments du lot H — décodage des pages hors du fil principal — en un seul tableau :
// console, Markdown et JSON. Même règle que les lots A, F et G : une ligne ne vaut que si le
// résultat est identique au bit près. Ce que Node mesure ici est le prix du contrat, pas son gain :
// `Worker` n'existe pas sous Node, donc les deux colonnes de temps exécutent le repli synchrone. Le
// gain, lui, est du temps rendu au fil principal du navigateur, et il se lit dans la campagne pixel.
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { ecrisBitAbit } from './tableau.mjs';

/** Un commit, ou `null` : une mesure sans provenance n'en est pas une. */
function sha(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Au-delà de cette charge moyenne, les chronomètres ne départagent plus rien d'honnête. */
const CHARGE_MAX = 4;
const charge = loadavg()[0];
const develop = sha('rev-parse', 'develop');
const socle = sha('merge-base', 'HEAD', 'develop');
const lignes = [
  socle
    ? `Base du lot : \`${socle}\` ; \`develop\` au moment de la mesure : \`${develop}\`.`
    : null,
  'Node exécute le repli synchrone : « Avant » et « Après » y mesurent le prix du contrat (copie de ' +
    'la page compressée, aller-retour des messages), jamais le temps rendu au fil principal. ' +
    '« Retenu » veut donc dire « livré », et c’est l’égalité bit à bit qui le décide ; le gain, lui, ' +
    'est du temps rendu au fil principal du navigateur, et il se lit dans la campagne pixel.',
];
if (charge > CHARGE_MAX)
  lignes.push(
    `Machine chargée pendant la mesure (charge moyenne sur une minute : ${charge.toFixed(1)}, ` +
      `seuil ${CHARGE_MAX}) : temps non concluants.`,
  );

ecrisBitAbit({
  nom: 'calculs-h2',
  titre: 'Calculs, lot H2 : décodage hors du fil principal, avant / après',
  extra: { lot: 'H2', develop, socle, chargeMachine: charge, tempsConcluants: false },
  note: lignes.filter(Boolean).join('\n'),
});
