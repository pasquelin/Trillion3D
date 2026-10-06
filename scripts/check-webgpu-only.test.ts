import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { glHits } from './check-webgpu-only.ts'

const script = new URL('./check-webgpu-only.ts', import.meta.url).pathname
const GL = ['g', 'l'].join('')
const word = ['web', GL].join('')

/** One sample of each pattern, assembled so that this file never matches the gate. */
const SAMPLES = [
  ['Web', GL, '2RenderingContext'],
  ["canvas.getContext('web", GL],
  ['EXT_', 'disjoint_timer_query'],
  ['EXT_', 'color_buffer_float'],
  ['O', 'ES_texture_float'],
  ['UNPACK_', 'FLIP_Y'],
  [GL, '_FragColor'],
  [GL, '_Position'],
  ['#version ', '300 es'],
  ['Open', GL],
  [word],
  [GL.toUpperCase(), 'SL'],
  ['const ', GL, '2 = 1'],
].map((pieces) => pieces.join(''))

/** A throwaway repository holding `files` (path -> content), committed. */
function repository(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'webgpu-only-'))
  execFileSync('git', ['init', '-q', root])
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  execFileSync('git', ['-C', root, 'add', '-A'])
  return root
}

test('each pattern of the GL family is found, case-insensitive, on its line', (t) => {
  for (const sample of SAMPLES) {
    const root = repository({ 'src/a.ts': `// fine\n\nx ${sample.toLowerCase()} y\n` })
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const hits = glHits(root)
    assert.equal(hits.length, 1, sample)
    assert.equal(hits[0]?.file, 'src/a.ts')
    assert.equal(hits[0]?.line, 3)
  }
})

test('a file name of the GL family is a hit on line 0', (t) => {
  const root = repository({ [`src/${word}-view.ts`]: 'export {}\n' })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(
    glHits(root).map((hit) => hit.line),
    [0],
  )
})

test('a hit across a read boundary of a long JSON line is found once, on its line', (t) => {
  const long = `{"a":"${'x'.repeat((1 << 16) - 10)}${word}","b":"${'y'.repeat(2_100_000)}${word}"}`
  const root = repository({ 'data/big.json': `{}\n${long}\n` })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(
    glHits(root).map((hit) => [hit.line, hit.match]),
    [
      [2, word],
      [2, word],
    ],
  )
})

test('binaries and other files over 2 MB are not read', (t) => {
  const root = repository({
    'image.png': Buffer.concat([Buffer.from([0x89, 0]), Buffer.from(word)]),
    'model.obj': `${'v 0 0 0\n'.repeat(260_000)}${word}\n`,
  })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  assert.deepEqual(glHits(root), [])
})

test('the command prints path:line: match and fails on a hit, passes on a clean tree', (t) => {
  const dirty = repository({ 'docs/a.md': `ok\n${word}\n`, 'src/b.ts': 'export {}\n' })
  const clean = repository({ 'src/b.ts': 'export const gpu = "WebGPU"\n' })
  t.after(() => [dirty, clean].forEach((root) => rmSync(root, { recursive: true, force: true })))
  const failed = spawnSync(process.execPath, [script, dirty], { encoding: 'utf8' })
  assert.equal(failed.status, 1)
  assert.equal(failed.stderr.trim(), `docs/a.md:2: ${word}`)
  assert.equal(spawnSync(process.execPath, [script, clean]).status, 0)
})
