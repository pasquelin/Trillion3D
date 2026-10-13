// Every reader of a placement row reads it through a view (`placementWorld`, a blended copy's or
// item's `matrix`), never the rows' buffer itself: the composition writes a row a parent composes
// for its readers only when one of its views is read (`composeReaders.ts`), so a reader of the raw
// buffer would read the world of the last read. The engine's source touches `matrices` in the
// writers of the rows alone — the owner's pose, a model's meshes, the bodies, the partition's cells
// — and where the rows are made, grown and viewed; a new module that does must be one of them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const SOURCE = fileURLToPath(new URL('..', import.meta.url))

/** The modules that write rows, and the one that makes, grows and views them. */
const TOUCHING = [
  'partition/follow.ts',
  'physics/placer.ts',
  'placement/rows.ts',
  'world/core/worldModels.ts',
  'world/core/worldPoses.ts',
]

/** Each engine module, tests and fixtures left out, with its text. */
function* engineModules(dir: string): Generator<[string, string]> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* engineModules(path)
    else if (/\.ts$/.test(entry.name) && !/\.(test|fixture)\.ts$/.test(entry.name))
      yield [relative(SOURCE, path), readFileSync(path, 'utf8')]
  }
}

test("the rows' buffer is touched by their writers and their views alone", () => {
  const touching = [...engineModules(SOURCE)]
    .filter(([, text]) => /\.matrices\b/.test(text))
    .map(([path]) => path.split('\\').join('/'))
    .sort()
  assert.deepEqual(touching, TOUCHING)
})

test('the writers write the buffer: none of them reads a row of it', () => {
  for (const path of TOUCHING.filter((path) => path !== 'placement/rows.ts')) {
    const text = readFileSync(join(SOURCE, path), 'utf8')
    for (const line of text.split('\n').filter((line) => /\.matrices\b/.test(line)))
      assert.match(
        line,
        /\.matrices\.set\(|multiplyMatrix4\(rows\.matrices,|matrices\[rank\] = /,
        `${path}: ${line.trim()}`,
      )
  }
})
