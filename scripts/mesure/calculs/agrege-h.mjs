#!/usr/bin/env node
// Assemble les fragments du lot H — décodage des pages hors du fil principal — en un seul tableau :
// console, Markdown et JSON. Même règle que les lots A, F et G : une ligne ne vaut que si le
// résultat est identique au bit près. Ce que Node mesure ici est le prix du contrat, pas son gain :
// `Worker` n'existe pas sous Node, donc les deux colonnes de temps exécutent le repli synchrone. Le
// gain, lui, est du temps rendu au fil principal du navigateur, et il se lit dans la campagne pixel.
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { ecrisBitAbit } from './tableau.mjs';

/** Le commit de `develop` sous le lot : ce que la mesure a réellement sous les pieds. */
function base() {
  try {
    return execFileSync('git', ['rev-parse', 'develop'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Au-delà de cette charge moyenne, les chronomètres ne départagent plus rien d'honnête. */
const CHARGE_MAX = 4;
const charge = loadavg()[0];
const develop = base();
const lignes = [
  develop ? `Lot H rebasé sur develop \`${develop}\`.` : null,
  'Node exécute le repli synchrone : « Avant » et « Après » y mesurent le prix du contrat (copie de ' +
    'la page compressée, aller-retour des messages), jamais le temps rendu au fil principal. Seule ' +
    'la colonne « Identique » et la campagne navigateur font foi pour le gain.',
];
if (charge > CHARGE_MAX)
  lignes.push(
    `Machine chargée pendant la mesure (charge moyenne sur une minute : ${charge.toFixed(1)}, ` +
      `seuil ${CHARGE_MAX}) : temps non concluants.`,
  );

ecrisBitAbit({
  nom: 'calculs-h2',
  titre: 'Calculs, lot H2 : décodage hors du fil principal, avant / après',
  extra: { lot: 'H2', develop, chargeMachine: charge, tempsConcluants: false },
  note: lignes.filter(Boolean).join('\n'),
});
