import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeInstalledScene(directory, variant = 0, columns = 96, rows = 48) {
  mkdirSync(directory, { recursive: true });
  const lines = [];
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

export function compileInstalledScene({ fixture, executable, run, pnpm, name, variant }) {
  const sourceFile = writeInstalledScene(join(fixture, `native-source-${name}`), variant);
  const stdout = run(
    pnpm,
    [
      'exec',
      'web-geometry-compile',
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
    { ...process.env, WEB_GEOMETRY_COMPILER_BIN: executable },
  );
  const result = JSON.parse(stdout);
  if (result.status !== 'ready') throw new Error(`installed CLI did not prepare ${name}`);
  return result;
}
