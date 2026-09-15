#!/usr/bin/env node
// Les ressources d'un paquet qui ne sont pas du code : `tsc` ne les connaît pas et ne les copie pas,
// or un hôte qui sert le `dist/` construit tel quel les demande par leur URL, à côté du module qui
// les charge. Sans cette étape, `pageCodec.wasm` manque du `dist/` et le décodeur WebAssembly
// retombe en silence sur le décodeur JavaScript. Le fichier commis fait foi : cette étape ne
// compile rien, elle recopie (`npm run build:wasm` est ce qui le reconstruit).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESSOURCES = [['sdk-browser', 'pageCodec.wasm']];

let copies = 0;
for (const [paquet, nom] of RESSOURCES) {
  const source = join(RACINE, 'packages', paquet, nom);
  if (!existsSync(source)) throw new Error(`ressource absente : packages/${paquet}/${nom}`);
  const dossier = join(RACINE, 'dist', paquet);
  mkdirSync(dossier, { recursive: true });
  copyFileSync(source, join(dossier, nom));
  copies++;
}
process.stderr.write(`copied ${copies} package resources\n`);
