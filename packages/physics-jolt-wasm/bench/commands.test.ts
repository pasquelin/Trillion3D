// `bench/commands.h` is the one command-file reader of the native benches (`native.cpp`,
// `water.cpp`): compiled here with the system C++ compiler (`c++` on the PATH, as the CI image has)
// and run on each edge case of the file.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DRIVER = `#include "commands.h"
int main(int, char **argv) {
  std::vector<uint32_t> words;
  if (!readCommands(argv[1], words)) { std::printf("missing"); return 0; }
  std::printf("%zu", words.size());
  for (uint32_t word : words) std::printf(" %u", word);
}
`;

const dir = mkdtempSync(join(tmpdir(), 'trillion3d-bench-commands-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const driver = join(dir, 'driver');
execFileSync(
  'c++',
  [
    '-std=c++17',
    '-Wall',
    '-Wextra',
    '-Werror',
    '-I',
    import.meta.dirname,
    '-x',
    'c++',
    '-',
    '-o',
    driver,
  ],
  { input: DRIVER },
);

let files = 0;

/** What the reader returns for a file holding `bytes`, or for no file when `bytes` is null. */
function read(bytes: Uint8Array | null): string {
  const path = join(dir, `commands-${files++}.bin`);
  if (bytes) writeFileSync(path, bytes);
  return execFileSync(driver, [path], { encoding: 'utf8' });
}

const words = (...values: number[]) => new Uint8Array(Uint32Array.from(values).buffer);

test('a missing file is refused', () => {
  assert.equal(read(null), 'missing');
});

test('an empty file reads as no command word', () => {
  assert.equal(read(new Uint8Array(0)), '0');
});

test('a complete file reads every word in order', () => {
  assert.equal(read(words(1, 0xdeadbeef, 0, 42)), `4 1 ${0xdeadbeef} 0 42`);
});

test('a trailing partial word is ignored, the complete words kept', () => {
  const bytes = new Uint8Array([...words(7, 9), 0xff, 0xff, 0xff]);
  assert.equal(read(bytes), '2 7 9');
  assert.equal(read(new Uint8Array([1, 2])), '0');
});
