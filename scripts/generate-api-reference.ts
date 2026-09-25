// The two API files git never tracks (#683), from the declarations of the public entries: the
// portal's reference, one entry per export, family member and world member with its signature and
// TSDoc; and the export inventory. `pnpm install` writes them, every reader rewrites them first
// when a source is newer. The translations, `api.<language>.json`, are the translators' alone.
import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repositoryFiles } from './repository-files.ts';

const ROOT = resolve(import.meta.dirname, '..');

/** Where the reference and the inventory are written. */
export const API_FILES = {
  reference: 'site/content/reference/api.json',
  inventory: 'site/data/api-inventory.json',
} as const;

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const modified = (file: string) => statSync(join(ROOT, file), { throwIfNoEntry: false })?.mtimeMs;

/** Whether both files are newer than every source file of the repository: the declarations they
 *  read, the consumers the inventory names, their generators. */
function current(): boolean {
  const since = Math.min(...Object.values(API_FILES).map((file) => modified(file) ?? 0));
  const sources = (repositoryFiles() ?? []).filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
  return since > 0 && sources.every((file) => (modified(file) ?? 0) <= since);
}

/** Writes the reference and the inventory from the current sources, unless they are current. */
export async function generateApiFiles(): Promise<void> {
  if (current()) return;
  // Loaded only here: TypeScript and the model cost a second to every reader of current files.
  const [{ FAMILIES }, { buildReference }, { apiInventory }, { writeGenerated }] =
    await Promise.all([
      import('../site/content/model.ts'),
      import('./api-reference/exports.ts'),
      import('./sdk-api-inventory.ts'),
      import('./sdk-api-model.ts'),
    ]);
  await writeGenerated(API_FILES.reference, json(buildReference(new Set(FAMILIES))));
  await writeGenerated(API_FILES.inventory, json(apiInventory()));
}

if (import.meta.filename === process.argv[1]) await generateApiFiles();
