#!/usr/bin/env node
// Assemble les fragments du lot H — décodage des pages hors du fil principal — en un seul tableau :
// console, Markdown et JSON. Même règle que les lots A, F et G : une ligne ne vaut que si le
// résultat est identique au bit près. Ce que Node mesure ici est le prix du contrat, pas son gain :
// `Worker` n'existe pas sous Node, donc les deux colonnes de temps exécutent le repli synchrone. Le
// gain, lui, est du temps rendu au fil principal du navigateur, et il se lit dans la campagne pixel.
import { contexteLot, ecrisBitAbit } from './tableau.mjs';

const { note, ...contexte } = contexteLot(
  'Node exécute le repli synchrone : ces colonnes ne montrent donc jamais le temps rendu au fil ' +
    'principal, qui est le gain visé et qui ne se lit qu’en navigateur. Elles montrent le reste : ' +
    'le prix du contrat (copie de la page compressée, aller-retour des messages) et, pour H1, le ' +
    'gain du décodeur lui-même, le module WebAssembly contre le décodeur JavaScript. « Retenu » ' +
    'exige l’égalité bit à bit, qui seule décide.',
);

ecrisBitAbit({
  nom: 'calculs-h2',
  titre: 'Calculs, lot H2 : décodage hors du fil principal, avant / après',
  // Sous Node les deux colonnes exécutent le même repli : les temps ne concluent jamais ici,
  // quelle que soit la charge de la machine.
  extra: { lot: 'H2', ...contexte, tempsConcluants: false },
  note,
});
