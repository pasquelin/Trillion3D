import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { transform } from 'esbuild';
import { compile } from 'tailwindcss';

const require = createRequire(import.meta.url);
const SOURCE_EXTENSIONS = new Set(['.html', '.js', '.jsx', '.ts', '.tsx']);
const TOKEN = /[!@A-Za-z0-9_:[\]().,%/#-]+/g;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
      }),
  );
  return files.flat();
}

async function collectCandidates(root) {
  const files = [
    resolve(root, 'docs/index.html'),
    ...(await sourceFiles(resolve(root, 'docs/js'))),
    ...(await sourceFiles(resolve(root, 'docs/react'))),
  ];
  const candidates = new Set();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const token of source.match(TOKEN) ?? []) candidates.add(token);
  }
  return [...candidates].sort();
}

function stylesheetPath(id, base) {
  if (id.startsWith('.')) return resolve(base, id);
  if (id === 'tailwindcss') return require.resolve('tailwindcss/index.css');
  return require.resolve(id, { paths: [base] });
}

async function loadStylesheet(id, base) {
  const path = stylesheetPath(id, base);
  return { path, base: dirname(path), content: await readFile(path, 'utf8') };
}

async function loadModule(id, base) {
  const path = require.resolve(id, { paths: [base] });
  const imported = await import(path);
  return { path, base: dirname(path), module: imported.default ?? imported };
}

export async function buildStyles(
  root,
  { minify = true, output = resolve(root, 'docs/css/site.css') } = {},
) {
  const input = resolve(root, 'docs/styles/tailwind.css');
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
