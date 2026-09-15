#!/usr/bin/env node
// Assemble les fragments déposés par les fichiers de banc en un seul tableau : console, Markdown et
// JSON brut. Ce qui n'est pas mesuré vaut `null` ; rien n'est déduit d'un autre champ.
import { ecrisBitAbit } from './tableau.mjs';

ecrisBitAbit({ nom: 'calculs', titre: 'Calculs : avant / après' });
