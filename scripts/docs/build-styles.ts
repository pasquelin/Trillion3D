import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { transform } from 'esbuild';
import { compile, type Config } from 'tailwindcss';

const require = createRequire(import.meta.url);
const SOURCE_EXTENSIONS = new Set(['.html', '.ts', '.tsx']);
const TOKEN = /[!@A-Za-z0-9_:[\]().,%/#-]+/g;

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry): Promise<string[]> => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
      }),
  );
  return files.flat();
}

/** The sources, under the root, scanned for class names: a folder's HTML and TypeScript files. */
export const STYLE_SOURCES = [
  'site/index.html',
  'site/app',
  'site/content',
  'site/demos',
  'site/examples/kit',
  'site/reports',
];

async function collectCandidates(root: string): Promise<string[]> {
  const files = await Promise.all(
    STYLE_SOURCES.map(async (path) => {
      const source = resolve(root, path);
      return (await stat(source)).isDirectory() ? sourceFiles(source) : [source];
    }),
  );
  const candidates = new Set<string>();
  for (const file of files.flat()) {
    const source = await readFile(file, 'utf8');
    for (const token of source.match(TOKEN) ?? []) candidates.add(token);
  }
  return [...candidates].sort();
}

function stylesheetPath(id: string, base: string): string {
  if (id.startsWith('.')) return resolve(base, id);
  if (id === 'tailwindcss') return require.resolve('tailwindcss/index.css');
  return require.resolve(id, { paths: [base] });
}

async function loadStylesheet(id: string, base: string) {
  const path = stylesheetPath(id, base);
  return { path, base: dirname(path), content: await readFile(path, 'utf8') };
}

/** A Tailwind config or plugin module: TypeScript cannot know the shape of a file resolved and
 * imported by a runtime id, so the dynamic import is cast once at this boundary. */
async function loadModule(id: string, base: string) {
  const path = require.resolve(id, { paths: [base] });
  const imported = (await import(path)) as { default?: Config } & Config;
  return { path, base: dirname(path), module: imported.default ?? imported };
}

/** Compiles the site's Tailwind stylesheet into `output`, scanning the sources for class names. */
export async function buildStyles(
  root: string,
  { minify = true, output }: { minify?: boolean; output: string },
) {
  const input = resolve(root, 'site/styles/tailwind.css');
  const source = await readFile(input, 'utf8');
  const compiler = await compile(source, {
    base: dirname(input),
    from: input,
    loadModule,
    loadStylesheet,
  });
  const candidates = await collectCandidates(root);
  let css = compiler.build(candidates);
  if (minify) css = (await transform(css, { loader: 'css', minify: true })).code;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, css);
  return { candidates, css, output };
}
