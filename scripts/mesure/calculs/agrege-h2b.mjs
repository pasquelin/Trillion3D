#!/usr/bin/env node
// Assemble le fragment du lot H2b en un tableau : console, Markdown et JSON. Même règle que les
// autres lots de l'audit — une ligne n'est retenue que si les deux décodeurs rendent exactement les
// mêmes tampons et que le module WebAssembly est le plus rapide.
import { contexteLot, ecrisBitAbit } from './tableau.mjs';

// Ce que le tableau ne dit pas tout seul : pourquoi la ligne des refus n'est pas retenue.
const { note, ...contexte } = contexteLot(
  'Le module recopie la page dans sa mémoire linéaire avant de lire son en-tête : sur une page ' +
    "refusée dès l'en-tête, cette copie coûte plus que le refus, et la ligne H2b2 n'est donc pas " +
    "retenue. La rendre rapide demanderait de redire les bornes de l'en-tête en JavaScript, c'est-" +
    "à-dire de tenir deux vérités au lieu d'une ; le refus reste identique, avec la même cause.",
);

ecrisBitAbit({
  nom: 'calculs-h2b',
  titre: 'Calculs, lot H2b : décodeur de pages, JavaScript contre WebAssembly',
  extra: { lot: 'H2b', ...contexte },
  note,
});
