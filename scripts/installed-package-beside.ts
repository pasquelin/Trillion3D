import { basename, dirname, join } from 'node:path';

/** One emitted chunk: its path under the bundle's root, and its text. */
export interface EmittedChunk {
  path: string;
  text: string;
}

/** What a chunk naming `marker` must find in its own folder: the modules it fetches by its own
 *  URL (`new URL('./x', import.meta.url)`) and the workers it starts (`besideModule`). */
export interface BesideRule {
  marker: string;
  beside: string[];
}

/** The engine's modules, each fetched beside the chunk that names it: the page decoder's, and
 *  Jolt's two with the worker that runs them. */
const BESIDE_RULES: BesideRule[] = [
  { marker: 'pageCodec.wasm', beside: ['pageCodec.wasm'] },
  {
    marker: 'joltPhysics.wasm',
    beside: ['physicsWorker.js', 'joltPhysics.wasm', 'joltPhysicsThreads.wasm'],
  },
];

/** Every rule's module found missing beside a chunk that names it, as one line each; a rule no
 *  chunk names is a line too — the bundle lost the code that loads it. Paths are checked in the
 *  chunk's own folder, whether it sits at the root or deeper. */
export function missingBeside(
  chunks: EmittedChunk[],
  assets: string[],
  rules: BesideRule[] = BESIDE_RULES,
): string[] {
  const present = new Set(assets);
  return rules.flatMap(({ marker, beside }) => {
    const naming = chunks.filter(({ text }) => text.includes(marker));
    if (!naming.length) return [`no chunk names ${marker}`];
    return naming.flatMap(({ path }) =>
      beside
        .filter((file) => !present.has(join(dirname(path), file)))
        .map((file) => `${path} does not find ${basename(file)} beside it`),
    );
  });
}
