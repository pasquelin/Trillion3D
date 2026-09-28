import { readdir, readFile } from 'node:fs/promises';
import { roadmapEntries } from '../../../site/app/examples/list.ts';

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

/** The pages parked until the engine draws them: opened for their errors, never asked to draw. */
export const parkedExampleIds = new Set(
  roadmapEntries.filter(({ status }) => status === 'waiting-engine').map(({ id }) => id),
);
