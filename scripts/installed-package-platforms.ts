import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPILER_PLATFORMS,
  compilerFileName,
  compilerPackage,
} from '../packages/sdk-node/src/compiler/platform.mts';
import type { Run } from './installed-package-contracts.ts';
import { packArchive } from './installed-package-fixture.ts';

/** This machine's platform package, the one an install of `trillion3d` here takes. */
const localPlatform = `${process.platform}-${process.arch}`;

/**
 * The compiler's platform packages as a fixture installs them (#1352): each packed from a copy of
 * `packages/compiler/<os>-<arch>`, this machine's carrying `binary` when one is given, so that the
 * optional dependencies of `trillion3d` resolve without a registry and the install keeps the one
 * its platform runs. Returns each package's name and its archive.
 */
export function packPlatformArchives(options: {
  root: string;
  fixture: string;
  run: Run;
  pnpm: string;
  binary: string | null;
}): [name: string, archive: string][] {
  const { root, fixture, run, pnpm, binary } = options;
  return COMPILER_PLATFORMS.map((target) => {
    const copy = join(fixture, 'platforms', target);
    mkdirSync(join(copy, 'bin'), { recursive: true });
    copyFileSync(
      join(root, 'packages/compiler', target, 'package.json'),
      join(copy, 'package.json'),
    );
    if (binary && target === localPlatform)
      copyFileSync(binary, join(copy, 'bin', compilerFileName(process.platform)));
    const archive = packArchive(run, pnpm, copy, fixture).filename;
    const [platform, arch] = target.split('-');
    const name = compilerPackage(platform, arch);
    if (!name) throw new Error(`${target}: no compiler package`);
    return [name, archive];
  });
}

/** The fixture's `pnpm-workspace.yaml`: each platform package pointed at its archive. */
export function packPlatformPackages(options: Parameters<typeof packPlatformArchives>[0]): string {
  const overrides = packPlatformArchives(options).map(
    ([name, archive]) => `  ${JSON.stringify(name)}: ${JSON.stringify(`file:${archive}`)}`,
  );
  return `overrides:\n${overrides.join('\n')}\n`;
}
