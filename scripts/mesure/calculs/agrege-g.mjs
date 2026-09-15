#!/usr/bin/env node
// Assemble les fragments du lot G en un seul tableau : console, Markdown et JSON. Le lot G garde la
// règle des lots A et F — égalité bit à bit — donc le même en-tête et le même rendu de ligne. Les
// points natifs déposent leur fragment dans le même dossier : le tableau porte les douze points.
import { contexteLot, ecrisBitAbit } from './tableau.mjs';

const { note, ...contexte } = contexteLot();

ecrisBitAbit({
  nom: 'calculs-g',
  titre: 'Calculs, lot G : avant / après',
  extra: { lot: 'G', ...contexte },
  note,
});
