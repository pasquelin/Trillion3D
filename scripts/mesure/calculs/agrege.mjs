#!/usr/bin/env node
// Assemble les fragments déposés par les fichiers de banc en un seul tableau : console, Markdown et
// JSON brut. Ce qui n'est pas mesuré vaut `null` ; rien n'est déduit d'un autre champ.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENTETE, RACINE, commit, fragments, SEPARATEUR, ligneMarkdown } from './banc.mjs';

const FRAGMENTS = join(RACINE, '.mesure', 'calculs');
const SORTIE = join(RACINE, 'orchestration', 'mesures');

const lignes = fragments(FRAGMENTS);

const jour = new Date().toISOString().slice(0, 10);
const tableau = [ENTETE, SEPARATEUR, ...lignes.map(ligneMarkdown)].join('\n');
const retenus = lignes.filter((ligne) => ligne.retenu).length;
const resume = `${lignes.length} calculs comparés, ${retenus} retenus, ${
  lignes.filter((ligne) => !ligne.identique).length
} écarts bit à bit.`;

console.log(`\n${tableau}\n\n${resume}`);

mkdirSync(SORTIE, { recursive: true });
writeFileSync(
  join(SORTIE, `calculs-${jour}.md`),
  `# Calculs : avant / après (${jour})\n\n` +
    `Machine : ${process.platform}/${process.arch}, Node ${process.version}. Commit \`${commit()}\`.\n` +
    `Médiane sur N tours après échauffement ; « Retenu » exige l'égalité bit à bit ET un gain.\n` +
    `DPR, résolution d'affichage et FPS : sans objet ici, ces mesures sont des calculs CPU purs.\n\n${tableau}\n\n${resume}\n`,
);
writeFileSync(
  join(SORTIE, `calculs-${jour}.json`),
  `${JSON.stringify(
    {
      version: 1,
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
console.log(`\nÉcrit : orchestration/mesures/calculs-${jour}.md et .json`);
