// A site page run by the GPU bench as the browser runs it: its module scripts, its two runtime
// modules (`../runtime/engine.js`, `../runtime/kit.js`) read from the measured checkout's sources,
// its elements made by the bench's document. The reference examples and the held-out validation
// pages alike.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { World } from '../../packages/sdk-browser/src/index.ts';
import { measureOutput } from '../core/paths.ts';

/** Where a held-out validation page lies: outside the repository, never tuned against. */
const VALIDATION_DIR = process.env.TRILLION3D_VALIDATION_DIR ?? '';

/** The page file a name means: a path, an example's name in `root`, or a validation page's
 *  prefix (`v06`). */
export function pageFile(name: string, root: string) {
  if (existsSync(name)) return resolve(name);
  const example = join(root, 'site', 'examples', `${name.replace(/\.html$/, '')}.html`);
  if (existsSync(example)) return example;
  if (VALIDATION_DIR && existsSync(VALIDATION_DIR)) {
    const held = readdirSync(VALIDATION_DIR).find(
      (file) => file.startsWith(name) && file.endsWith('.html'),
    );
    if (held) return join(VALIDATION_DIR, held);
  }
  throw new Error(
    `BENCH_PAGE: no page ${name} (an example's name, a path, or TRILLION3D_VALIDATION_DIR)`,
  );
}

/** What the bench reads from a page: its module scripts, its canvases and other elements. */
export function readPage(file: string) {
  const html = readFileSync(file, 'utf8');
  const scripts = [
    ...html.matchAll(/<script\b[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/g),
  ].map((found) => found[1]);
  if (!scripts.length) throw new Error(`BENCH_PAGE: ${basename(file)} has no module script`);
  const canvasIds = [...html.matchAll(/<canvas\b[^>]*\bid=["']([^"']+)["']/g)].map(
    (found) => found[1],
  );
  const elementIds = [
    ...html.matchAll(/<(?!canvas\b)[a-z][a-z0-9-]*\b[^>]*\bid=["']([^"']+)["']/g),
  ].map((found) => found[1]);
  return { scripts, canvasIds, elementIds, title: /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '' };
}

/**
 * The address the page is read at: beside the checkout's own examples, so what it loads relative
 * to itself (`../assets/…`) is that checkout's, whichever folder holds the file. `search` carries
 * the page's address switches (`?trillion3dGpuLog=1`).
 */
export function pageAddress(file: string, root: string, search: string) {
  const folder = dirname(file).endsWith('examples') ? 'examples' : 'validation';
  return `${pathToFileURL(join(root, 'site', folder, basename(file))).href}${search}`;
}

/** The page's `../runtime/engine.js`: the checkout's engine, whose `createWorld` also hands the
 *  bench each world the page makes. */
const engineModule = (engine: string) => `export * from '${engine}';
import { createWorld as engineWorld } from '${engine}';
export function createWorld(...args) {
  const world = engineWorld(...args);
  (globalThis.benchWorlds ??= []).push(world);
  return world;
}
`;

/** Writes the page's scripts as one module whose runtime imports name the checkout's sources, and
 *  imports it: the page runs. Resolves to the worlds it made. */
export async function runPage(file: string, root: string, scripts: readonly string[]) {
  const out = measureOutput('bench-gpu', 'pages');
  mkdirSync(out, { recursive: true });
  const engine = join(out, `engine-${process.pid}.mjs`);
  writeFileSync(
    engine,
    engineModule(pathToFileURL(join(root, 'packages', 'sdk-browser', 'src', 'index.ts')).href),
  );
  const runtime: Record<string, string> = {
    '../runtime/engine.js': pathToFileURL(engine).href,
    '../runtime/kit.js': pathToFileURL(join(root, 'site', 'examples', 'kit', 'index.ts')).href,
  };
  let code = scripts.join('\n;\n');
  for (const [from, to] of Object.entries(runtime))
    code = code.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `'${to}'`);
  const left = /from\s+['"](\.{1,2}\/[^'"]+)['"]/.exec(code);
  if (left)
    throw new Error(
      `BENCH_PAGE: ${basename(file)} imports ${left[1]}, which the bench does not map`,
    );
  const module = join(out, `${basename(file, '.html')}-${process.pid}.mjs`);
  writeFileSync(module, code);
  await import(pathToFileURL(module).href);
  return ((globalThis as { benchWorlds?: World[] }).benchWorlds ?? []) as World[];
}
