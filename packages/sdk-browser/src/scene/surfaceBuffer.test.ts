import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import {
  SURFACE_BYTES_PER_PIXEL,
  SURFACE_FORMATS,
  checkSurfaceSize,
  frameTargetBytes,
  createSurfaceBuffer,
} from './surfaceBuffer.ts'
import { EMISSIVE_AO_SURFACE_FLAG, SURFACE_MODEL } from './surfaceModel.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'

test('a surface rejects an invalid or off-device size, and nothing else: no byte ceiling', () => {
  const { device } = fakeDevice({ limits: { maxTextureDimension2D: 1024 } })
  assert.throws(() => checkSurfaceSize(device, 0, 10), /INVALID_SURFACE_SIZE/)
  assert.throws(() => checkSurfaceSize(device, 1025, 1), /SURFACE_DEVICE_LIMIT/)
  assert.equal(checkSurfaceSize(device, 100, 100), 330000)
  assert.equal(checkSurfaceSize(device, 1024, 1024), 1024 * 1024 * 33, 'targets follow resolution')
  assert.equal(
    frameTargetBytes(3, 3, true),
    9 * 57 + 9 * 4 + (9 + 4 + 1) * 4 + 8,
    'no material depth: 24 B/px beside the surfaces; the Hi-Z pyramid as made, odd levels at ceil dimensions',
  )
})

test('the per-pixel frame holds the shadow receiver target: 25 B/px and its 8', () => {
  assert.equal(SURFACE_BYTES_PER_PIXEL, 25 + 8)
  const gpu = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  const surface = createSurfaceBuffer(gpu.device, 3840, 2160)
  assert.equal(surface.allocationBytes, 3840 * 2160 * SURFACE_BYTES_PER_PIXEL + 8)
  assert.equal(gpu.buffers.length, 0, 'no per-pixel buffer beside the targets')
  assert.equal(
    gpu.textures.length,
    6,
    'disabled transmission has one 1×1 texture, beside the receiver target',
  )
  surface.dispose()
  surface.dispose()
  assert.equal(gpu.destroyed.length, 6, 'six textures, each exactly once')
})

test('a partial surface allocation failure destroys all textures already allocated', () => {
  let created = 0
  const { device, destroyed } = fakeDevice({
    limits: { maxTextureDimension2D: 1024 },
    refuse: () => (++created === 3 ? 'throw' : undefined),
  })
  assert.throws(() => createSurfaceBuffer(device, 16, 16), /NO_MEMORY/)
  assert.equal(destroyed.length, 2)
})

/** The fourth argument of every `SurfaceOut(…)` the resolve builds, and every value it assigns
 *  to `flag`: the expressions of the flags target. */
function flagExpressions(shader: string) {
  const found: string[] = []
  for (const at of shader.matchAll(/SurfaceOut\(/g)) {
    const args: string[] = []
    let depth = 0,
      start = at.index + at[0].length
    for (let i = start; depth >= 0; i++) {
      const c = shader[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      if ((c === ',' && depth === 0) || depth < 0) {
        args.push(shader.slice(start, i))
        start = i + 1
      }
    }
    if (args.length === 5) found.push(args[3])
  }
  for (const [, value] of shader.matchAll(/\bflag=(?!=)([^;]+);/g)) found.push(value)
  return found.filter((expression) => expression !== 'flag')
}

test('every flag the resolve writes fits the r8uint flags target unchanged', () => {
  assert.equal(SURFACE_FORMATS[3], 'r8uint')
  const select = (f: number, t: number, c: boolean) => (c ? t : f)
  const written = new Set<number>()
  for (const expression of flagExpressions(SHADE_SHADER)) {
    const run = new Function(
      'select',
      'model',
      'page',
      'flag',
      'emissiveAoFlag',
      'emissive',
      'ao',
      `return ${expression.replace(/(\d)u\b/g, '$1')};`,
    )
    for (const model of Object.values(SURFACE_MODEL))
      for (const flags of [0, 1])
        for (const flag of [1, 2, 4, 5])
          for (const mark of [0, EMISSIVE_AO_SURFACE_FLAG])
            written.add(run(select, model, { flags }, flag, () => mark) as number)
  }
  // Background 0, unlit 1, lit 2, as-is 3, diffuse 4, toon 5: the whole documented set; a surface
  // shown unlit or lit with its emission-and-occlusion mark (#1369).
  const marked = [1, 2, 4, 5].map((flag) => flag | EMISSIVE_AO_SURFACE_FLAG)
  assert.deepEqual(
    [...written].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, ...marked],
  )
  for (const value of written) {
    assert.equal(Uint32Array.of(value)[0], value, `${value} as the r32uint target held it`)
    assert.equal(Uint8Array.of(value)[0], value, `${value} as the r8uint target holds it`)
  }
})
