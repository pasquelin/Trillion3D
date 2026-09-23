// Fetching the public sample models, reproducibly and once.
//
// One sparse clone of the official repository holds every missing model, so the set is fetched in
// a single network round: `--filter=blob:none` downloads no blob until the checkout asks for one,
// and `--depth 1` keeps no history. A scene folder already on disk is never touched — the fetch is
// idempotent, and the sources under `.mesure/assets/<scene>/` are read-only for everything else.
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLE_REPOSITORY, kebab, sceneGltfFile } from './assetsCatalogue.ts';

function git(args: string[], cwd?: string) {
  const run = spawnSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed (${run.status})`);
}

/** Models of `wanted` (repository names) whose scene folder carries no glTF yet. */
export const missingModels = (assets: string, wanted: string[]) =>
  wanted.filter((name) => sceneGltfFile(join(assets, kebab(name))) === null);

/**
 * Copies `Models/<Name>/glTF` of the sample repository into `.mesure/assets/<kebab-name>/`, for
 * every model that is not there yet. Returns the scene names written, empty when nothing was
 * missing. The clone is thrown away: what is kept is the models' own files, at the top of the
 * scene folder, exactly as the repository publishes them.
 */
export function fetchModels(assets: string, wanted: string[]) {
  const missing = missingModels(assets, wanted);
  if (missing.length === 0) return [];
  const clone = mkdtempSync(join(tmpdir(), 'trillion3d-sample-assets-'));
  try {
    git(['clone', '--filter=blob:none', '--no-checkout', '--depth', '1', SAMPLE_REPOSITORY, clone]);
    git(['sparse-checkout', 'init', '--no-cone'], clone);
    git(
      ['sparse-checkout', 'set', '--no-cone', ...missing.map((n) => `/Models/${n}/glTF/`)],
      clone,
    );
    git(['checkout'], clone);
    for (const name of missing) {
      const from = join(clone, 'Models', name, 'glTF');
      if (sceneGltfFile(from) === null) throw new Error(`no glTF in Models/${name}/glTF`);
      const into = join(assets, kebab(name));
      mkdirSync(into, { recursive: true });
      cpSync(from, into, { recursive: true });
    }
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
  return missing.map(kebab);
}
