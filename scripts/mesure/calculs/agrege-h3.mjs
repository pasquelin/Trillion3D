#!/usr/bin/env node
// Assemble les fragments du lot H3 — le chemin des textures : transfert des bandes vers l'atlas et
// ordre de transfert par image — en un seul tableau : console, Markdown et JSON. Même règle que les
// lots A, F, G et H2 : une ligne ne vaut que si le résultat est identique au bit près.
import { contexteLot, ecrisBitAbit } from './tableau.mjs';

const { note, ...contexte } = contexteLot(
  'H3-1 mesure la recopie des bandes évitée avant `writeTexture` : Node la voit entièrement, ' +
    'c’est de la mémoire et rien d’autre. H3-2 mesure le recalcul de l’ordre de transfert par ' +
    'image ; son gain est petit devant le bruit d’une machine chargée.',
);

ecrisBitAbit({
  nom: 'calculs-h3',
  titre: 'Calculs, lot H3 : chemin des textures, avant / après',
  extra: { lot: 'H3', ...contexte },
  note,
});
