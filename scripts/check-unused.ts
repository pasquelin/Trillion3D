import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `pnpm run check:unused`: knip, twice. The first pass (`knip.config.ts`) takes the tests as
// entries: a file or an export that nothing reaches is dead. The second
// (`knip.production.config.ts`) takes only what the engine, the SDK and their tools run: a source
// file or an export that only a test, a fixture or the test kit reaches is dead too (#1366).

const knip = fileURLToPath(new URL('../node_modules/.bin/knip', import.meta.url));

/** Each pass: its configuration, and whether it reads only production patterns. */
const UNUSED_PASSES = [
  { config: 'knip.config.ts', production: false },
  { config: 'knip.production.config.ts', production: true },
] as const;

/** Runs both passes on `directory`: the first failing status (0 when both pass) and their output. */
export function checkUnused(directory = process.cwd()): { status: number; output: string } {
  let status = 0,
    output = '';
  for (const { config, production } of UNUSED_PASSES) {
    const args = ['--config', join(directory, config), '--directory', directory, '--no-progress'];
    const result = spawnSync(knip, production ? [...args, '--production'] : args, {
      encoding: 'utf8',
    });
    if (result.error) throw result.error;
    output += result.stdout + result.stderr;
    status ||= result.status ?? 1;
  }
  return { status, output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { status, output } = checkUnused();
  process.stdout.write(output);
  process.exit(status);
}
