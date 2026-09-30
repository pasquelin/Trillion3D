import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMPILER_PLATFORMS,
  compilerFileName,
  compilerPackage,
} from '../packages/sdk-node/src/compiler/platform.mts';
import type { Run } from './installed-package-contracts.ts';
import type { PackResult } from './installed-package-fixture.ts';

/** This machine's platform package, the one an install of `trillion3d` here takes. */
const localPlatform = `${process.platform}-${process.arch}`;

/**
 * The compiler's platform packages as the fixture installs them (#1352): each packed from a copy
 * of `packages/compiler/<os>-<arch>`, this machine's carrying `binary` when one is given, so that
 * the optional dependencies of `trillion3d` resolve without a registry and the install keeps the
 * one its platform runs. Returns the fixture's `pnpm-workspace.yaml`, which points each name at
 * its archive.
 */
export function packPlatformPackages(options: {
  root: string;
  fixture: string;
  run: Run;
  pnpm: string;
  binary: string | null;
}): string {
  const { root, fixture, run, pnpm, binary } = options;
  const overrides = COMPILER_PLATFORMS.map((target) => {
    const copy = join(fixture, 'platforms', target);
    mkdirSync(join(copy, 'bin'), { recursive: true });
    copyFileSync(
      join(root, 'packages/compiler', target, 'package.json'),
      join(copy, 'package.json'),
    );
    if (binary && target === localPlatform)
      copyFileSync(binary, join(copy, 'bin', compilerFileName(process.platform)));
    const parsed = JSON.parse(
      run(pnpm, ['pack', '--json', '--pack-destination', fixture], copy),
    ) as PackResult | PackResult[];
    const archive = (Array.isArray(parsed) ? parsed[0] : parsed)?.filename;
    if (!archive) throw new Error(`pnpm pack did not report the ${target} archive`);
    const [platform, arch] = target.split('-');
    return `  ${JSON.stringify(compilerPackage(platform, arch))}: ${JSON.stringify(`file:${archive}`)}`;
  });
  return `overrides:\n${overrides.join('\n')}\n`;
}
