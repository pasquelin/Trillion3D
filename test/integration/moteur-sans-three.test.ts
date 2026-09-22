import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { AUTORISES, DECLARATION } from './moteur-sans-three-listes.ts';

const browser = new URL('../../packages/sdk-browser/', import.meta.url);

/**
 * How `declaration` is looked for, and what the search cannot see.
 *
 * Comments and string literals are removed first, then the WORD is looked for: that catches the
 * property read, the field written in an object, the type that declares it, `const { declaration }
 * = rec` and `const [{ declaration }] = pages`, which a `.declaration` pattern all missed. A key
 * written as a string is the one form the stripping hides, so it is looked for on the raw text.
 *
 * What it cannot see: a host material reached under another name. The WebGL2 owner draws HOST
 * MESHES, and a host mesh's own field is `material` (`WholeMesh`, `clusterBatchMesh.ts`);
 * renaming it would be renaming the host library's. Three files read it there — the draw record
 * that hands it to the renderer, the frustum classification that must see a diagnostic repaint
 * live (`webglClusterCopyCulling.ts`) and the whole-mesh raster oracle — and none of them is on
 * the engine's page path, which holds the record. The transparent copy, which was the one
 * contract to hand a host material out under that name, no longer declares one at all
 * (`blendCopyContract.ts`).
 */
const sansCommentaires = (texte: string) =>
  texte
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, ' ');
const LIT_LA_DECLARATION = /\bdeclaration\b/;
const LIT_LA_CLE = /\[\s*(['"`])declaration\1\s*\]/;
const litLaDeclaration = (texte: string) =>
  LIT_LA_DECLARATION.test(sansCommentaires(texte)) || LIT_LA_CLE.test(texte);

const IMPORTE_HOTE = /^\s*(?:import|export)\b[^\n]*\bfrom\s+['"]three(?:\/[^'"]*)?['"]/m;
/** A call of the crossing back, `asHostLibrary<T>(x)` or `asHostLibrary(x)`, never its import. */
const TRAVERSE = /\basHostLibrary\s*[<(]/;

/** The package's own sources. The two host-library rules below read these alone: `bench/` is the
 *  measurement harness, whose oracles and scene mounts are written with the host library by
 *  design — they are what the engine is compared against. */
const sources = async () =>
  (await readdir(browser)).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));

/** Those sources AND every file under them, `bench/` included: the declaration rule holds for the
 *  benches too, since a bench builds the page records the engine path then reads. */
async function toutesSources(prefix = ''): Promise<string[]> {
  const entries = await readdir(new URL(prefix, browser), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) found.push(...(await toutesSources(`${name}/`)));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) found.push(name);
  }
  return found;
}

/** Files outside the closed list where a pattern appears; `exclu` is the file that declares it. */
async function horsListe(motif: RegExp, exclu = ''): Promise<string[]> {
  const fuites: string[] = [];
  for (const file of await sources()) {
    if (file === exclu || AUTORISES[file.slice(0, -3)]) continue;
    if (motif.test(await readFile(new URL(file, browser), 'utf8'))) fuites.push(file);
  }
  return fuites;
}

test('only declared files import the host library', async () => {
  assert.ok((await sources()).length > 100, 'the browser package must be found');
  const fuites = await horsListe(IMPORTE_HOTE);
  assert.deepEqual(fuites, [], `closed list declared in ${import.meta.url}`);
});

// `hostResources.ts` declares the crossing; the same closed list says who may call it, so the
// doc of `asHostLibrary` stays a rule and not a hope.
test('only the declared boundary files cross back through `asHostLibrary`', async () => {
  const fuites = await horsListe(TRAVERSE, 'hostResources.ts');
  assert.deepEqual(fuites, [], `the crossing back belongs to the list of ${import.meta.url}`);
});

test('no dead lines: each declared file exists and still imports', async () => {
  const fichiers = new Set(await sources());
  const morts = [];
  for (const [nom, raison] of Object.entries(AUTORISES)) {
    const file = `${nom}.ts`;
    assert.ok(raison.length > 10, `${file} must say why`);
    if (!fichiers.has(file)) morts.push(`${file} no longer exists`);
    else if (!IMPORTE_HOTE.test(await readFile(new URL(file, browser), 'utf8')))
      morts.push(`${file} no longer imports the host library: remove its line`);
  }
  assert.deepEqual(morts, [], 'an unused authorisation is removed from the list');
});

test('only the declared files read the host declaration a page was collected from', async () => {
  const fuites: string[] = [],
    morts: string[] = [];
  const fichiers = await toutesSources();
  assert.ok(
    fichiers.some((name) => name.startsWith('bench/')),
    'the benches are read too',
  );
  for (const file of fichiers)
    if (litLaDeclaration(await readFile(new URL(file, browser), 'utf8'))) {
      if (!DECLARATION[file.slice(0, -3)]) fuites.push(file);
    } else if (DECLARATION[file.slice(0, -3)]) morts.push(file);
  assert.deepEqual(
    fuites,
    [],
    `the engine path reads \`material\`, the record (${import.meta.url})`,
  );
  assert.deepEqual(morts, [], 'an authorisation whose file no longer reads the field is removed');
});

test('`cameraWorld.ts` remains the only translation from host camera to engine camera', async () => {
  const texte = await readFile(new URL('cameraWorld.ts', browser), 'utf8');
  assert.match(texte, /export type HostCamera = THREE\.PerspectiveCamera/);
  assert.match(texte, /export function readCameraWorld\(/);
  const moteur = await readFile(new URL('engineCamera.ts', browser), 'utf8');
  for (const champ of ['world', 'projection', 'view', 'viewProjection', 'planes', 'eye'])
    assert.match(moteur, new RegExp(`\\b${champ}\\b`), champ);
});
