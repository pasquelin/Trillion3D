/**
 * The site: handwritten sources under `site/`, one built tree under `dist/site/` that git ignores.
 * Every consumer — `build:docs`, `docs:serve`, the browser proofs, the site deployment — builds
 * the same tree from the same function; nothing under `site/` is a build product.
 */
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { gitPathsSync } from '../git-paths.ts';
import { buildFlags } from './build-flags.ts';
import { buildPortal } from './build-portal.ts';
import { buildRuntime } from './build-runtime.ts';
import { buildStyles } from './build-styles.ts';

const ROOT = resolve(import.meta.dirname, '../..');
export const SITE_OUTPUT = resolve(ROOT, 'dist/site');

/** The one public address of the site: its canonical link and its crawler rules derive from it,
 * and the deployment checks the address the built page declares. */
export const SITE_URL = 'https://www.trillion3d.com/';

/** What the site serves as is: examples, scene assets, data records and the reports. */
const STATIC_ENTRIES = ['examples', 'assets', 'data', 'reports'];
/** What the build writes at the root from `SITE_URL`: the portal page and the crawler rules. */
const METADATA_ENTRIES = ['index.html', 'robots.txt'];
/** Source modules living beside the reports' records are not served. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

async function unchanged(source: string, target: string): Promise<boolean> {
  try {
    const [from, to] = await Promise.all([stat(source), stat(target)]);
    return from.size === to.size && from.mtimeMs <= to.mtimeMs;
  } catch {
    return false;
  }
}

/** Removes from `folder` every entry `keep` does not name: the copy mirrors its sources. */
async function prune(folder: string, keep: readonly string[]) {
  for (const name of await readdir(folder))
    if (!keep.includes(name)) await rm(resolve(folder, name), { recursive: true, force: true });
}

/** Copies `source` into `target`, files only when missing or older, sources never; what the
 * sources no longer have, the copy loses. */
async function copyTree(source: string, target: string) {
  const entry = await stat(source);
  if (entry.isDirectory()) {
    await mkdir(target, { recursive: true });
    const names = await readdir(source);
    for (const name of names) await copyTree(resolve(source, name), resolve(target, name));
    await prune(target, names);
    return;
  }
  if (SOURCE_EXTENSIONS.has(extname(source)) || (await unchanged(source, target))) return;
  await copyFile(source, target);
}

/** The folders of `out` the build writes: emptied first, so no chunk of an earlier build stays. */
const BUILT_FOLDERS = ['css', 'runtime', 'flags'];

/** Writes the build products into `out`: styles, engine runtime, portal, language flags. */
export async function buildBundles(root: string, out: string) {
  for (const folder of BUILT_FOLDERS)
    await rm(resolve(out, folder), { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await buildStyles(root, { output: resolve(out, 'css/site.css') });
  await buildRuntime(root, resolve(out, 'runtime'));
  await buildPortal(root, resolve(out, 'runtime'));
  await buildFlags(resolve(out, 'flags'));
}

/** Writes the portal page with its canonical link, and crawler rules that allow everything. The
 * portal routes by hash, so the root is the only address a crawler can list: no sitemap. */
async function writeMetadata(source: string, out: string) {
  const page = await readFile(resolve(source, 'index.html'), 'utf8');
  const canonical = `    <link rel="canonical" href="${SITE_URL}" />\n  </head>`;
  const written = page.replace(/[ \t]*<\/head>/, canonical);
  if (written === page) throw new Error('site/index.html has no </head>');
  await writeFile(resolve(out, 'index.html'), written);
  await writeFile(resolve(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
}

/** Copies the served statics of the site `source` tree into `out`, sources excluded, and writes
 * the root pages the site address shapes. */
export async function copyStatics(source: string, out: string) {
  await mkdir(out, { recursive: true });
  for (const name of STATIC_ENTRIES) await copyTree(resolve(source, name), resolve(out, name));
  await writeMetadata(source, out);
  await prune(out, [...STATIC_ENTRIES, ...METADATA_ENTRIES, ...BUILT_FOLDERS]);
}

/** Builds the whole site from `root` into `out`. */
export async function buildSite(root = ROOT, out = SITE_OUTPUT) {
  await buildBundles(root, out);
  await copyStatics(resolve(root, 'site'), out);
}

/** The files of the built site git tracks: always none, since CI builds it from the sources. */
export function trackedOutput(root = ROOT, out = SITE_OUTPUT) {
  return gitPathsSync(['ls-files', '-z', '--', relative(root, out)], root);
}
