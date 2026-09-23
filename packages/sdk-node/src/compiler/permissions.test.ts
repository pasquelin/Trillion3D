import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepare } from '../index.mts';

test('an existing compiler without execute permission is reported distinctly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'web-geometry-permission-'));
  try {
    const executable = join(root, 'compiler');
    await writeFile(executable, '#!/bin/sh\nexit 0\n');
    await chmod(executable, 0o644);
    await assert.rejects(
      prepare('in', 'out', 'slice', 1, { executable, resourceBaseUrl: '/assets/' }),
      /COMPILER_EXECUTABLE_NOT_EXECUTABLE:/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
