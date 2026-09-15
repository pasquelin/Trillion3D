#!/usr/bin/env node
// Assemble les fragments du lot C en un seul tableau : console, Markdown et JSON. Le lot C ajoute la
// colonne « Écart » : un changement qui déplace l'ordre flottant doit dire de combien il déplace.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RACINE } from './banc.mjs';
import { ENTETE_C, SEPARATEUR_C, ligneMarkdownC } from './bancC.mjs';

const FRAGMENTS = join(RACINE, '.mesure', 'calculs-c');
const SORTIE = join(RACINE, 'orchestration', 'mesures');

function commit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const lignes = readdirSync(FRAGMENTS)
  .filter((nom) => nom.endsWith('.json'))
  .flatMap((nom) => JSON.parse(readFileSync(join(FRAGMENTS, nom), 'utf8')))
  .sort((a, b) => Number(a.calcul.slice(1, 3).trim()) - Number(b.calcul.slice(1, 3).trim()));

const jour = new Date().toISOString().slice(0, 10);
const tableau = [ENTETE_C, SEPARATEUR_C, ...lignes.map(ligneMarkdownC)].join('\n');
const retenus = lignes.filter((ligne) => ligne.retenu).length;
const resume = `${lignes.length} calculs comparés, ${retenus} retenus, ${
  lignes.filter((ligne) => !ligne.identique).length
} écarts bit à bit.`;

console.log(`\n${tableau}\n\n${resume}`);

mkdirSync(SORTIE, { recursive: true });
writeFileSync(
  join(SORTIE, `calculs-c-${jour}.md`),
  `# Calculs, lot C : avant / après (${jour})\n\n` +
    `Machine : ${process.platform}/${process.arch}, Node ${process.version}. Commit \`${commit()}\`.\n` +
    `Médiane sur N tours après échauffement. « Retenu » exige l'égalité bit à bit, ou un écart nul\n` +
    `sur les identifiants de pixels et d'au plus 1 ULP sur les profondeurs, ET un gain de temps.\n` +
    `DPR, résolution d'affichage et FPS : sans objet ici, ces mesures sont des calculs CPU purs.\n\n${tableau}\n\n${resume}\n`,
);
writeFileSync(
  join(SORTIE, `calculs-c-${jour}.json`),
  `${JSON.stringify(
    {
      version: 1,
      lot: 'C',
      date: new Date().toISOString(),
      commit: commit(),
      node: process.version,
      plateforme: `${process.platform}/${process.arch}`,
      dpr: null,
      fps: null,
      lignes,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nÉcrit : orchestration/mesures/calculs-c-${jour}.md et .json`);
