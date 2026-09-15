#!/usr/bin/env node
// Assemble le fragment du lot H2b en un tableau : console, Markdown et JSON. Même règle que les
// autres lots de l'audit — une ligne n'est retenue que si les deux décodeurs rendent exactement les
// mêmes tampons et que le module WebAssembly est le plus rapide.
import { loadavg } from 'node:os';
import { ecrisBitAbit } from './tableau.mjs';

/** Au-delà de cette charge moyenne, les chronomètres ne départagent plus rien d'honnête. */
const CHARGE_MAX = 4;
const charge = loadavg()[0];

/** Ce que le tableau ne dit pas tout seul : pourquoi la ligne des refus n'est pas retenue. */
const REFUS =
  'Le module recopie la page dans sa mémoire linéaire avant de lire son en-tête : sur une page ' +
  "refusée dès l'en-tête, cette copie coûte plus que le refus, et la ligne H2b2 n'est donc pas " +
  "retenue. La rendre rapide demanderait de redire les bornes de l'en-tête en JavaScript, c'est-" +
  "à-dire de tenir deux vérités au lieu d'une ; le refus reste identique, avec la même cause.";

ecrisBitAbit({
  nom: 'calculs-h2b',
  titre: 'Calculs, lot H2b : décodeur de pages, JavaScript contre WebAssembly',
  extra: { lot: 'H2b', chargeMachine: charge, tempsConcluants: charge <= CHARGE_MAX },
  note:
    charge > CHARGE_MAX
      ? `Machine chargée pendant la mesure (charge moyenne sur une minute : ${charge.toFixed(1)}, ` +
        `seuil ${CHARGE_MAX}) : temps non concluants, seule la colonne « Identique » fait foi.\n` +
        REFUS
      : REFUS,
});
