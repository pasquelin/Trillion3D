#!/usr/bin/env node
// Assemble les fragments du lot C en un seul tableau : console, Markdown et JSON. Le lot C ajoute la
// colonne « Écart » : un changement qui déplace l'ordre flottant doit dire de combien il déplace.
import { ecris, lisFragments, nombre, pourcent } from './tableau.mjs';

const ligne = (l) =>
  `| ${l.calcul} | \`${l.fichier}\` | ${nombre(l.avantMs)} | ${nombre(l.apresMs)} | ${pourcent(
    l.gain,
  )} | ${l.identique ? 'oui' : 'non'} | ${l.ecart ?? '—'} | ${l.retenu ? 'oui' : 'non'} |`;

ecris({
  nom: 'calculs-c',
  titre: 'Calculs, lot C : avant / après',
  preambule:
    `Médiane sur N tours après échauffement. « Retenu » exige l'égalité bit à bit, ou un écart nul\n` +
    `sur les identifiants de pixels et d'au plus 1 ULP sur les profondeurs, ET un gain de temps.`,
  entete: '| Calcul | Fichier | Avant (ms) | Après (ms) | Gain | Identique | Écart | Retenu |',
  separateur: '|---|---|---|---|---|---|---|---|',
  ligne,
  lignes: lisFragments('calculs-c'),
  extra: { lot: 'C' },
});
