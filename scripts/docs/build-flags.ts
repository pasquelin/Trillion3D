import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { LANGUAGES } from '../../site/content/i18n/dictionary.ts';

/** The folder of `flag-icons` (MIT) holding one 4:3 SVG per ISO 3166 region code. */
export const FLAG_SOURCE = resolve(
  dirname(createRequire(import.meta.url).resolve('flag-icons/package.json')),
  'flags/4x3',
);

/**
 * Copies into `outdir` the flag of each language, the region code of its dictionary's `meta.flag`,
 * and the package's licence beside them: only the flags a language names are served, each fetched
 * when the language selector shows it.
 */
export async function buildFlags(outdir: string) {
  await mkdir(outdir, { recursive: true });
  const flags = new Set(LANGUAGES.map(({ flag }) => flag));
  await Promise.all([
    ...[...flags].map((flag) =>
      copyFile(resolve(FLAG_SOURCE, `${flag}.svg`), resolve(outdir, `${flag}.svg`)),
    ),
    copyFile(resolve(FLAG_SOURCE, '../../LICENSE'), resolve(outdir, 'LICENSE')),
  ]);
}
