#!/usr/bin/env node
// Assemble les fragments du lot G en un seul tableau : console, Markdown et JSON. Le lot G garde la
// règle des lots A et F — égalité bit à bit — donc le même en-tête et le même rendu de ligne. Les
// points natifs déposent leur fragment dans le même dossier : le tableau porte les douze points.
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
const lignes = [develop ? `Lot G rebasé sur develop \`${develop}\`.` : null];
if (charge > CHARGE_MAX)
  lignes.push(
    `Machine chargée pendant la mesure (charge moyenne sur une minute : ${charge.toFixed(1)}, ` +
      `seuil ${CHARGE_MAX}) : temps non concluants, seule la colonne « Identique » fait foi.`,
  );
const note = lignes.filter(Boolean).join('\n') || undefined;

ecrisBitAbit({
  nom: 'calculs-g',
  titre: 'Calculs, lot G : avant / après',
  extra: { lot: 'G', develop, chargeMachine: charge, tempsConcluants: charge <= CHARGE_MAX },
  note,
});
