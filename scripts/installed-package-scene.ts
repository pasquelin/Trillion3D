import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Run } from './installed-package-contracts.ts';

const COLUMNS = 96,
  ROWS = 48;
/** Triangles of the installed scene at full detail: two per grid cell, each placed once. */
export const INSTALLED_SCENE_TRIANGLES = COLUMNS * ROWS * 2;

function writeInstalledScene(
  directory: string,
  variant = 0,
  columns = COLUMNS,
  rows = ROWS,
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

/** Compiles a generated scene with the installed CLI, which finds the compiler in the platform
 *  package installed beside it: `TRILLION3D_COMPILER_BIN` is removed from its environment. */
export function compileInstalledScene({
  fixture,
  run,
  pnpm,
  name,
  variant,
}: {
  fixture: string;
  run: Run;
  pnpm: string;
  name: string;
  variant: number;
}): CompiledScene {
  const sourceFile = writeInstalledScene(join(fixture, `native-source-${name}`), variant);
  const { TRILLION3D_COMPILER_BIN: _named, ...environment } = process.env;
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
    environment,
  );
  const result = JSON.parse(stdout) as CompiledScene;
  if (result.status !== 'ready') throw new Error(`installed CLI did not prepare ${name}`);
  return result;
}
