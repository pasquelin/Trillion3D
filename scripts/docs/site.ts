/**
 * The site: handwritten sources under `site/`, one built tree under `dist/site/` that git ignores.
 * Every consumer — `build:docs`, `docs:serve`, the browser proofs, the site deployment — builds
 * the same tree from the same function; nothing under `site/` is a build product.
 */
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { API_FILES, API_SOURCES, generateApiFiles } from '../generate-api-reference.ts';
import { gitPathsSync } from '../git-paths.ts';
import { COOKED_SCENES, compileSiteCaches, sourceOf } from '../site-caches.ts';
import { buildFlags } from './build-flags.ts';
import { FRAMED_MEASUREMENT_TAG, withMeasurement } from './measurement.ts';
import { buildPortal } from './build-portal.ts';
import { buildRuntime } from './build-runtime.ts';
import { buildStyles, STYLE_SOURCES } from './build-styles.ts';

const ROOT = resolve(import.meta.dirname, '../..');
export const SITE_OUTPUT = resolve(ROOT, 'dist/site');

/** The one public address of the site: its canonical link and its crawler rules derive from it,
 * and the deployment checks the address the built page declares. */
export const SITE_URL = 'https://www.trillion3d.com/';

/** What the site serves as is: examples, scene assets, data records and the reports. */
export const STATIC_ENTRIES = ['examples', 'assets', 'data', 'reports'];
/** The pages the portal replaced, each moved to its route: an old link still lands on it. */
const REDIRECTS: Record<string, string> = { 'report.html': '#/en/reports' };
/** What the build writes at the root from `SITE_URL`: the portal page, the crawler rules and the
 *  redirects. */
const METADATA_ENTRIES = ['index.html', 'robots.txt', ...Object.keys(REDIRECTS)];
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
 * sources no longer have, the copy loses. A `published` copy gives every page the measurement
 * tag of a framed page: the statics' pages are the examples the portal frames. */
async function copyTree(source: string, target: string, published: boolean) {
  const entry = await stat(source);
  if (entry.isDirectory()) {
    await mkdir(target, { recursive: true });
    const names = await readdir(source);
    for (const name of names)
      await copyTree(resolve(source, name), resolve(target, name), published);
    await prune(target, names);
    return;
  }
  if (SOURCE_EXTENSIONS.has(extname(source))) return;
  /* A published page is written and not copied, every time: the measurement tag comes from this
     build and not from the page, so a page whose own source has not moved must still pick up a
     change made there. An unpublished one is copied as is; the size check below tells it apart
     from a published copy left by an earlier build, which the tag makes longer. */
  if (published && extname(source) === '.html') {
    await writeFile(
      target,
      withMeasurement(await readFile(source, 'utf8'), FRAMED_MEASUREMENT_TAG),
    );
    return;
  }
  if (await unchanged(source, target)) return;
  await copyFile(source, target);
}

/** One step of the build, with the paths under the root (files or folders) it reads and writes:
 *  the development server (`docs-dev.ts`) runs again only the steps a changed path is under. */
interface SiteStep {
  name: string;
  reads: readonly string[];
  /** Only the read files these name, when set. */
  files?: RegExp;
  /** What it writes under the root, read by a later step. */
  writes?: readonly string[];
  /** Its folder of `out`, emptied before it runs so no chunk of an earlier build stays; `run`
   *  gets it in place of `out`. */
  folder?: string;
  run: (root: string, out: string, published: boolean) => Promise<unknown> | void;
}

const scenes = Object.values(COOKED_SCENES);

/** Every step of `buildSite`, in its order: stale API files and caches first, then the build
 *  products (styles, engine runtime and portal in one folder, language flags), the statics last. */
const SITE_STEPS: readonly SiteStep[] = [
  {
    name: 'api',
    reads: ['packages', 'site'],
    files: API_SOURCES,
    writes: Object.values(API_FILES),
    run: () => generateApiFiles(),
  },
  {
    name: 'caches',
    reads: scenes.map((scene) => relative(ROOT, sourceOf(scene))),
    writes: scenes.map(({ directory }) => `${directory}/cache`),
    run: () => compileSiteCaches(false),
  },
  {
    name: 'styles',
    reads: ['site/styles', ...STYLE_SOURCES],
    folder: 'css',
    run: (root, css) => buildStyles(root, { output: resolve(css, 'site.css') }),
  },
  {
    name: 'runtime',
    // The engine's sources and the folders of `site/` the portal imports from.
    reads: [
      'packages',
      ...['app', 'content', 'demos', 'examples', 'i18n', 'reports'].map((name) => `site/${name}`),
    ],
    folder: 'runtime',
    run: async (root, runtime) => {
      await buildRuntime(root, runtime);
      await buildPortal(root, runtime);
    },
  },
  // No reads: `LANGUAGES` is loaded once per process, so a new language's flag needs a restart.
  { name: 'flags', reads: [], folder: 'flags', run: (_, flags) => buildFlags(flags) },
  {
    name: 'statics',
    reads: [...STATIC_ENTRIES, 'index.html'].map((name) => `site/${name}`),
    run: (root, out, published) => copyStatics(resolve(root, 'site'), out, published),
  },
];

/** The folders of `out` the build products are written in. */
const BUILT_FOLDERS = SITE_STEPS.flatMap(({ folder }) => folder ?? []);

/** Whether the `/`-separated `path` is `entry` or lies under it. */
export const underOrAt = (path: string, entry: string) =>
  path === entry || path.startsWith(`${entry}/`);

/** The steps, in order, that read one of `paths` (relative to the root, `/`-separated) or what an
 *  earlier one of them writes. */
export const stepsReading = (paths: Iterable<string>) => {
  const changed = [...paths];
  return SITE_STEPS.filter(({ reads, files, writes = [] }) => {
    const read = changed.some(
      (path) => (!files || files.test(path)) && reads.some((entry) => underOrAt(path, entry)),
    );
    if (read) changed.push(...writes);
    return read;
  });
};

/** Writes the build products into `out`. */
export const buildBundles = (root: string, out: string) =>
  buildSite(
    root,
    out,
    false,
    SITE_STEPS.filter(({ folder }) => folder),
  );

/** Writes the portal page with its canonical link, and crawler rules that allow everything. The
 * portal routes by hash, so the root is the only address a crawler can list: no sitemap. */
async function writeMetadata(source: string, out: string, published: boolean) {
  const page = await readFile(resolve(source, 'index.html'), 'utf8');
  const canonical = `    <link rel="canonical" href="${SITE_URL}" />\n  </head>`;
  const written = page.replace(/[ \t]*<\/head>/, canonical);
  if (written === page) throw new Error('site/index.html has no </head>');
  /* The measurement is applied here too: this function rewrites the page from its SOURCE, after
     `copyTree` has copied it, so the most visited page of the site would otherwise be the only
     one published without it. */
  await writeFile(resolve(out, 'index.html'), published ? withMeasurement(written) : written);
  await writeFile(resolve(out, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  for (const [page, route] of Object.entries(REDIRECTS))
    await writeFile(
      resolve(out, page),
      `<!doctype html>\n<meta charset="utf-8" />\n<title>Trillion3D</title>\n` +
        `<link rel="canonical" href="${SITE_URL}${route}" />\n` +
        `<meta http-equiv="refresh" content="0; url=./${route}" />\n` +
        `<a href="./${route}">${SITE_URL}${route}</a>\n`,
    );
}

/** Copies the served statics of the site `source` tree into `out`, sources excluded, and writes
 * the root pages the site address shapes; `published`, with the audience measurement. */
export async function copyStatics(source: string, out: string, published = false) {
  await mkdir(out, { recursive: true });
  for (const name of STATIC_ENTRIES)
    await copyTree(resolve(source, name), resolve(out, name), published);
  await writeMetadata(source, out, published);
  await prune(out, [...STATIC_ENTRIES, ...METADATA_ENTRIES, ...BUILT_FOLDERS]);
}

/** Builds the site from `root` into `out`, every step unless `steps` names some; only the
 * deployed build is `published`, and carries the audience measurement (`measurement.ts`). */
export async function buildSite(
  root = ROOT,
  out = SITE_OUTPUT,
  published = false,
  steps = SITE_STEPS,
) {
  for (const { folder, run } of steps) {
    const target = folder ? resolve(out, folder) : out;
    if (folder) await rm(target, { recursive: true, force: true });
    await run(root, target, published);
  }
}

/** The files of the built site git tracks: always none, since CI builds it from the sources. */
export function trackedOutput(root = ROOT, out = SITE_OUTPUT) {
  return gitPathsSync(['ls-files', '-z', '--', relative(root, out)], root);
}
