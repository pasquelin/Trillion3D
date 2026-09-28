import { readdir, readFile } from 'node:fs/promises';

const folder = new URL('../../../site/examples/', import.meta.url);

/** Every example page on disk, listed by the gallery or not: its id, its path under `site/` and
 *  its source. */
export async function examplePages() {
  const files = (await readdir(folder)).filter((file) => file.endsWith('.html'));
  return Promise.all(
    files.map(async (file) => ({
      id: file.slice(0, -'.html'.length),
      file: `examples/${file}`,
      html: await readFile(new URL(file, folder), 'utf8'),
    })),
  );
}
