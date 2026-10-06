// A texture pool the scene fills: the option read, the budget taken of the working set, the report.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readOptions } from './options.ts'
import { residentFraction, residentFractionBudget } from './poolFill.ts'
import { textures } from '../summary/summaryTextures.ts'

const ROOT = '/tmp/trillion3d-bench'
/** The live pools the command line asks with a texture pool of `value`. */
const livePools = (value?: string) =>
  readOptions(value === undefined ? [] : ['--texture-pool-live', value], ROOT).settings.livePools

test('a percentage is a fraction of the working set, a bare number stays MiB', () => {
  assert.equal(residentFraction('50%'), 0.5)
  assert.equal(residentFraction(' 12.5% '), 0.125)
  assert.equal(residentFraction('64'), undefined)
  for (const value of ['0%', '100%', '150%'])
    assert.throws(() => residentFraction(value), /strictly between/, value)
  assert.deepEqual(livePools('40%'), {
    geometryPoolBytes: undefined,
    texturePoolBytes: undefined,
    textureResidentFraction: 0.4,
  })
  const bytes = livePools('64')
  assert.equal(bytes?.texturePoolBytes, 64 * 1024 * 1024)
  assert.equal(bytes?.textureResidentFraction, undefined)
  assert.equal(livePools(), null)
})

test('the budget follows what the pose holds, whatever the scene', () => {
  // Twice the fraction: each atlas takes half the budget (`texturePoolFor`).
  assert.equal(residentFractionBudget(0.5, 59_224_192), 59_224_192)
  assert.equal(residentFractionBudget(0.25, 7_268_928), 3_634_464)
  assert.equal(residentFractionBudget(0.001, 100), 1, 'never an empty budget')
  for (const resident of [0, undefined])
    assert.throws(() => residentFractionBudget(0.5, resident), /no texture tile/)
})

test('the summary says what the live texture pool asked, held, evicted and cost', () => {
  const setting = {
    texturePool: {
      budgetBytes: 29_612_096,
      allocatedBytes: 50_331_648,
      clamp: 'minimum',
      layers: {},
    },
    evictedTiles: 212,
    durationMs: 3.456,
    recoveryFrames: 9,
    texturePoolAskedBytes: 29_612_096,
    residentTextureBytes: 59_224_192,
  } as unknown as NonNullable<Parameters<typeof textures>[1]>['liveTuning']
  const liveLine = (report?: typeof setting) =>
    textures({}, { liveTuning: report }).find((l) => l.includes('set live'))
  const line = liveLine(setting)
  assert.equal(
    line,
    '- Texture pool set live: 29.6 MB (28.24 MiB) asked (from 59.2 MB resident), 50.3 MB held (minimum); ' +
      '212 tiles evicted in 3.46 ms, pose held again after 9 frames',
  )
  assert.equal(liveLine(), undefined, 'nothing set, nothing said')
  const geometryOnly = { ...setting, texturePoolAskedBytes: undefined } as typeof setting
  assert.equal(
    liveLine(geometryOnly),
    undefined,
    'a live geometry pool alone says nothing of the texture pool',
  )
})
