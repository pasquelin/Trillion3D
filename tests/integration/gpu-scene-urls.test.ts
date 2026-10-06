// A scene a GPU proof names is where it names it (#683): a scene moved to another root once left
// a proof reading a path nothing held.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENE_ROOTS, manifestUrlOf } from '../kit/scenes/caches.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PROOFS = join(ROOT, 'tests/gpu')
/** A string literal, a path or a URL, that starts under a scene root. */
const SCENE_PATH = new RegExp(`['"\`]/?((?:${SCENE_ROOTS.join('|')})/[^'"\`$]+)`, 'g')

const files = readdirSync(PROOFS, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .map((file) => ({ file, text: readFileSync(join(PROOFS, file), 'utf8') }))
const named = files.flatMap(({ file, text }) =>
  [...text.matchAll(SCENE_PATH)].map(([, path]) => ({ file, path })),
)

// A path into a cache, the URL the #683 proof read by hand, is refused: a proof names the scene
// folder and derives what it reads from it, so the path its server serves is never written twice.
test('every scene a GPU proof names is a scene folder, never a cache path', () => {
  assert.ok(named.length > 0, 'no GPU proof names a scene')
  for (const { file, path } of named)
    assert.ok(!path.includes('/cache/'), `${file}: ${path} reaches into a cache; name the scene`)
})

// A proof reads a scene from its folder on disk (`kit/renderHarness.ts`): every scene it names is
// a scene with a committed source, so its compiled cache is where the proof looks for it.
test('every scene a GPU proof names is a scene folder with a source', () => {
  for (const { file, path } of named)
    assert.doesNotThrow(() => manifestUrlOf(path.replace(/\/$/, '')), `${file}: ${path}`)
})

test('a folder that is no scene, or a path into its cache, has no manifest URL', () => {
  assert.throws(() => manifestUrlOf('tests/kit'), /no scene with a source/)
  assert.throws(() => manifestUrlOf('tests/fixtures/formats/coplanar'), /no scene/)
  assert.throws(() => manifestUrlOf('tests/fixtures/scenes/mountain-terrain/cache/native/full'))
})
