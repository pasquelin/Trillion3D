import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Metafile } from 'esbuild';
import type { Bundle, Run, Write } from './installed-package-contracts.ts';

/** One child-process invocation the installed-package proof made, kept for the failure report. */
interface LogEntry {
  command: string[];
  cwd: string;
  stdout: string;
  stderr: string;
}

/** `pnpm pack --json`'s own report, read once at the boundary where it is produced: some pnpm
 * versions report a single object, others an array of one. */
export interface PackResult {
  filename?: string;
  files?: { path: string }[];
}

/** The fields of the repository's own `package.json` this proof reads. */
export interface PackageJson {
  name: string;
  packageManager?: string;
}

/** The installed package's own `package.json`, read back from the fixture's `node_modules`. */
export interface ExportsManifest {
  name: string;
  version: string;
  exports: { '.': { browser?: { import?: string } } };
}

export interface InstalledFixture {
  fixture: string;
  logs: LogEntry[];
  run: Run;
  write: Write;
  bundle: Bundle;
  installedVersion(name: string): string;
}

/** The temporary root, logs and `run`/`write`/`bundle` helpers shared by every stage of the
 * installed-package proof: one fixture directory, one `pnpm pack` archive installed into it. */
export function createInstalledFixture(root: string): InstalledFixture {
  const fixture = mkdtempSync(join(tmpdir(), 'trillion3d-installed-'));
  const logs: LogEntry[] = [];

  const run: Run = (command, args, cwd = root, environment = process.env) => {
    const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: environment });
    logs.push({ command: [command, ...args], cwd, stdout: result.stdout, stderr: result.stderr });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(
        `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}${result.stderr}`,
      );
    return result.stdout;
  };

  const write: Write = (name, value) => {
    writeFileSync(join(fixture, name), value);
  };

  function installedVersion(name: string): string {
    return (
      JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as {
        version: string;
      }
    ).version;
  }

  const bundle: Bundle = (name, source, platform = 'browser', conditions = null) => {
    write(`${name}.ts`, source);
    const conditionArgs = conditions === null ? [] : [`--conditions=${conditions.join(',')}`];
    run(
      join(root, 'node_modules/.bin/esbuild'),
      [
        `${name}.ts`,
        '--bundle',
        '--format=esm',
        `--platform=${platform}`,
        `--outfile=${name}.js`,
        `--metafile=${name}-meta.json`,
        ...conditionArgs,
      ],
      fixture,
    );
    return JSON.parse(readFileSync(join(fixture, `${name}-meta.json`), 'utf8')) as Metafile;
  };

  return { fixture, logs, run, write, bundle, installedVersion };
}
