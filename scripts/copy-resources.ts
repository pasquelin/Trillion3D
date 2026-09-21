#!/usr/bin/env node
// Non-code package resources: `tsc` does not know them and does not copy them,
// yet a host serving the built `dist/` as-is requests them by URL alongside the module loading
// them. Without this step, `pageCodec.wasm` is missing from `dist/` and the WebAssembly decoder
// silently falls back to JavaScript decoder. The committed file is authoritative: this step
// compiles nothing, it copies (`pnpm run build:wasm` is what rebuilds it).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESSOURCES: [string, string][] = [
  ['sdk-browser', 'pageCodec.wasm'],
  ['sdk', 'package.json'],
];

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
