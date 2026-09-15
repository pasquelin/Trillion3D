#!/usr/bin/env node
// Assemble les fragments du lot F en un seul tableau : console, Markdown et JSON. Le lot F garde la
// règle du lot A — égalité bit à bit — donc l'en-tête et le rendu de ligne de `banc.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENTETE, RACINE, SEPARATEUR, commit, fragments, ligneMarkdown } from './banc.mjs';
import { FRAGMENTS_F } from './bancF.mjs';

const SORTIE = join(RACINE, 'orchestration', 'mesures');

const lignes = fragments(FRAGMENTS_F);

const jour = new Date().toISOString().slice(0, 10);
const tableau = [ENTETE, SEPARATEUR, ...lignes.map(ligneMarkdown)].join('\n');
const retenus = lignes.filter((ligne) => ligne.retenu).length;
const resume = `${lignes.length} calculs comparés, ${retenus} retenus, ${
  lignes.filter((ligne) => !ligne.identique).length
} écarts bit à bit.`;

console.log(`\n${tableau}\n\n${resume}`);

mkdirSync(SORTIE, { recursive: true });
writeFileSync(
  join(SORTIE, `calculs-f-${jour}.md`),
  `# Calculs, lot F : avant / après (${jour})\n\n` +
    `Machine : ${process.platform}/${process.arch}, Node ${process.version}. Commit \`${commit()}\`.\n` +
    `Médiane sur N tours après échauffement ; « Retenu » exige l'égalité bit à bit ET un gain.\n` +
    `DPR, résolution d'affichage et FPS : sans objet ici, ces mesures sont des calculs CPU purs.\n\n${tableau}\n\n${resume}\n`,
);
writeFileSync(
  join(SORTIE, `calculs-f-${jour}.json`),
  `${JSON.stringify(
    {
      version: 1,
      lot: 'F',
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
console.log(`\nÉcrit : orchestration/mesures/calculs-f-${jour}.md et .json`);
