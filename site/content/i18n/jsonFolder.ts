import { readdirSync, readFileSync } from 'node:fs';

/**
 * The JSON files of `folder` whose name matches `pattern`, parsed and keyed by the pattern's first
 * group, in name order. Only a `.inline.ts` module (whose result the portal bundle keeps, run at
 * build time by `scripts/docs/inline-modules.ts`) or a script calls it: no browser reads a folder.
 */
export function readJsonFolder<T>(folder: URL, pattern: RegExp): Record<string, T> {
  return Object.fromEntries(
    readdirSync(folder)
      .sort()
      .flatMap((file) => {
        const code = pattern.exec(file)?.[1];
        return code ? [[code, JSON.parse(readFileSync(new URL(file, folder), 'utf8')) as T]] : [];
      }),
  );
}
