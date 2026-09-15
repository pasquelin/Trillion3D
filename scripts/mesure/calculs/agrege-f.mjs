#!/usr/bin/env node
// Assemble les fragments du lot F en un seul tableau : console, Markdown et JSON. Le lot F garde la
// règle du lot A — égalité bit à bit — donc le même en-tête et le même rendu de ligne.
import { ecrisBitAbit } from './tableau.mjs';

ecrisBitAbit({ nom: 'calculs-f', titre: 'Calculs, lot F : avant / après', extra: { lot: 'F' } });
