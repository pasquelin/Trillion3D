#!/usr/bin/env node
// Assemble les fragments du lot H3 — le chemin des textures : transfert des bandes vers l'atlas et
// ordre de transfert par image — en un seul tableau : console, Markdown et JSON. Même règle que les
// lots A, F, G et H2 : une ligne ne vaut que si le résultat est identique au bit près.
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
  'H3-1 mesure la recopie des bandes évitée avant `writeTexture` : Node la voit entièrement, ' +
    'c’est de la mémoire et rien d’autre. H3-2 mesure le recalcul de l’ordre de transfert par ' +
    'image ; son gain est petit devant le bruit d’une machine chargée.',
];
if (charge > CHARGE_MAX)
  lignes.push(
    `Machine chargée pendant la mesure (charge moyenne sur une minute : ${charge.toFixed(1)}, ` +
      `seuil ${CHARGE_MAX}) : temps non concluants.`,
  );

ecrisBitAbit({
  nom: 'calculs-h3',
  titre: 'Calculs, lot H3 : chemin des textures, avant / après',
  extra: {
    lot: 'H3',
    develop,
    socle,
    chargeMachine: charge,
    tempsConcluants: charge <= CHARGE_MAX,
  },
  note: lignes.filter(Boolean).join('\n'),
});
