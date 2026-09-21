/**
 * The site: handwritten sources under `site/`, one built tree under `dist/site/` that git ignores.
 * Every consumer — `build:docs`, `docs:serve`, the browser proofs, the Pages deployment — builds
 * the same tree from the same function; nothing under `site/` is a build product.
 */
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { gitPathsSync } from '../git-paths.mjs';
import { buildDemo } from './build-demo.mjs';
import { buildPortal } from './build-portal.mjs';
import { buildRuntime } from './build-runtime.mjs';
import { buildStyles } from './build-styles.mjs';

export const ROOT = resolve(import.meta.dirname, '../..');
export const SITE_SOURCE = resolve(ROOT, 'site');
export const SITE_OUTPUT = resolve(ROOT, 'dist/site');

/** What the site serves as is: pages, scene assets, data records and the measurement reports. */
const STATIC_ENTRIES = ['.nojekyll', 'index.html', 'report.html', 'assets', 'data', 'reports'];
/** Source modules living beside the reports' records are not served. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

async function unchanged(source, target) {
  try {
    const [from, to] = await Promise.all([stat(source), stat(target)]);
    return from.size === to.size && from.mtimeMs <= to.mtimeMs;
  } catch {
    return false;
  }
}

/** Copies `source` into `target`, files only when missing or older, sources never. */
async function copyTree(source, target) {
  const entry = await stat(source);
  if (entry.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const name of await readdir(source))
      await copyTree(resolve(source, name), resolve(target, name));
    return;
  }
  if (SOURCE_EXTENSIONS.has(extname(source)) || (await unchanged(source, target))) return;
  await copyFile(source, target);
}

/** Writes the build products into `out`: styles, engine runtime, demo maths, portal. */
export async function buildBundles(root, out) {
  await mkdir(out, { recursive: true });
  await buildStyles(root, { output: resolve(out, 'css/site.css') });
  await buildRuntime(root, resolve(out, 'runtime'));
  await buildDemo(root, resolve(out, 'js/engine.js'));
  await buildPortal(root, resolve(out, 'runtime'));
}

/** Copies the served statics of the site `source` tree into `out`, sources excluded. */
export async function copyStatics(source, out) {
  await mkdir(out, { recursive: true });
  for (const name of STATIC_ENTRIES) await copyTree(resolve(source, name), resolve(out, name));
}

/** Builds the whole site from `root` into `out`. */
export async function buildSite(root = ROOT, out = SITE_OUTPUT) {
  await buildBundles(root, out);
  await copyStatics(resolve(root, 'site'), out);
}

/** The files of the built site git tracks: always none, since Pages builds it from the sources. */
export function trackedOutput(root = ROOT, out = SITE_OUTPUT) {
  return gitPathsSync(['ls-files', '-z', '--', relative(root, out)], root);
}
