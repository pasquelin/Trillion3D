import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from './installed-package-contracts.ts';

function writeInstalledScene(
  directory: string,
  variant = 0,
  columns = 96,
  rows = 48,
): string {
  mkdirSync(directory, { recursive: true });
  const lines: string[] = [];
  for (let row = 0; row <= rows; row++)
    for (let column = 0; column <= columns; column++)
      lines.push(`v ${column / columns - 0.5} ${row / rows - 0.5} ${(variant * column) / columns}`);
  const stride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      if (column % 32 === 0) lines.push(`o installed-proof-grid-${row}-${Math.floor(column / 32)}`);
      const a = row * stride + column + 1,
        b = a + 1,
        c = a + stride,
        d = c + 1;
      lines.push(`f ${a} ${b} ${d}`, `f ${a} ${d} ${c}`);
    }
  }
  const source = join(directory, 'scene.obj');
  writeFileSync(source, `${lines.join('\n')}\n`);
  return source;
}

/** The native CLI's own JSON report, read once at the boundary where it is produced. */
export interface CompiledScene {
  status: string;
  [key: string]: unknown;
}

export function compileInstalledScene({
  fixture,
  executable,
  run,
  pnpm,
  name,
  variant,
}: {
  fixture: string;
  executable: string;
  run: Run;
  pnpm: string;
  name: string;
  variant: number;
}): CompiledScene {
  const sourceFile = writeInstalledScene(join(fixture, `native-source-${name}`), variant);
  const stdout = run(
    pnpm,
    [
      'exec',
      'trillion3d-compile',
      sourceFile,
      join(fixture, `native-cache-${name}`),
      'slice',
      '150000',
      `/native-source-${name}/`,
      '1',
      '256',
      'none',
    ],
    fixture,
    { ...process.env, TRILLION3D_COMPILER_BIN: executable },
  );
  const result = JSON.parse(stdout) as CompiledScene;
  if (result.status !== 'ready') throw new Error(`installed CLI did not prepare ${name}`);
  return result;
}
