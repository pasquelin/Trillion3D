// The CPU half of the WebGL2 particle draw (#844) on a strict fake GL: a blit into a depth copy
// of another format than the drawing buffer's is refused, as drivers do. The GPU is the recette's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ParticlePool, type ParticlePoolSpec } from '../../../../sdk-core/src/fluids/particles.ts'
import { createHostDrawCamera } from '../../camera/world.ts'
import { webgl } from '../../particles/stepModels.fixture.ts'

const output = { framebuffer: null, width: 8, height: 4, toneMapped: true }

/** Smoke 2 m ahead, fire 20 m ahead, a lone particle 50 m out: each with one more emitted. */
function scene() {
  const pool = (z: number, n: number, spec: Partial<ParticlePoolSpec> = {}) => {
    const made = new ParticlePool({ capacity: 8, origin: [0, 0, z], ...spec })
    for (let i = 0; i < n; i++) made.emit(0, 0, z, 0, 1, 0, 2)
    return made
  }
  return [pool(-2, 4, { blend: 'premultiplied' }), pool(-20, 3), pool(-50, 1)]
}

/** The depth formats the copy was made in, in order. */
const depths = (of: (name: string) => unknown[][]) =>
  of('texImage2D')
    .map(([, , format]) => `${format}`)
    .filter((format) => format.startsWith('DEPTH'))

test("WebGL2: the frame's depth is copied, then the pools far to near, each with its blend", () => {
  const { ctx, run, particles, errors, heard } = webgl(),
    pools = scene()
  assert.equal(particles.draw([], createHostDrawCamera(), output), 0)
  assert.deepEqual(ctx.of('blitFramebuffer'), [], 'no particle: nothing copied, nothing drawn')
  run(pools)
  errors.push('INVALID_OPERATION') // left by an earlier call: it never refuses the pools
  const from = ctx.calls.length
  assert.equal(particles.draw(pools, createHostDrawCamera(), output), 3)
  const calls = ctx.calls.slice(from).filter(({ name }) => /^(blit|blendFunc|drawArr)/.test(name))
  // The depth, then far to near: the lone particle, the fire (its alpha kept), the smoke over it.
  const drawn =
    'DEPTH_BUFFER_BIT NEAREST, ZERO ONE, 6 1, ZERO ONE, 6 3, ONE ONE_MINUS_SRC_ALPHA, 6 4'
  assert.equal(calls.map(({ args }) => args.slice(-2).join(' ')).join(', '), drawn)
  assert.deepEqual([depths(ctx.of), heard], [['DEPTH24_STENCIL8'], []], 'stencil-packed first')
  const [, fragment] = ctx.of('shaderSource').find(([, text]) => `${text}`.includes('sceneDepth'))!
  assert.match(`${fragment}`, /soft = [^;]*clamp\(behind \/ look\[2\]\.x, 0\., 1\.\)/)
})

test('WebGL2: a drawing buffer with DEPTH_COMPONENT24 alone takes the second probe, once', () => {
  const { ctx, run, particles, heard } = webgl(undefined, 'DEPTH_COMPONENT24'),
    pools = scene()
  run(pools)
  assert.equal(particles.draw(pools, createHostDrawCamera(), output), 3, 'drawn soft')
  assert.deepEqual(depths(ctx.of), ['DEPTH24_STENCIL8', 'DEPTH_COMPONENT24'], 'in this order')
  assert.equal(ctx.of('framebufferTexture2D').at(-1)?.[1], 'DEPTH_ATTACHMENT')
  run(pools)
  assert.equal(particles.draw(pools, createHostDrawCamera(), output), 3)
  assert.equal(depths(ctx.of).length, 2, 'the format found is kept: no probe again')
  assert.deepEqual([heard, pools[0].refused], [[], false])
})

test('WebGL2: the page and a render target each keep the format found, probed once each', () => {
  const { ctx, run, particles, heard } = webgl(),
    pools = scene(),
    target = { ...output, framebuffer: {} as WebGLFramebuffer }
  run(pools)
  for (let frame = 0; frame < 3; frame++)
    for (const to of [output, target])
      assert.equal(particles.draw(pools, createHostDrawCamera(), to), 3, 'drawn soft on both')
  const made = ['DEPTH24_STENCIL8', 'DEPTH_COMPONENT24']
  assert.deepEqual(depths(ctx.of), made, 'the target probed once, each copy made once')
  assert.equal(ctx.of('blitFramebuffer').length, 6 + 1, 'one blit a draw, one refused probe')
  assert.deepEqual(heard, [])
})

test('WebGL2: a depth neither format copies refuses the pools by name, never drawn hard', () => {
  const { ctx, run, particles, heard } = webgl(undefined, 'DEPTH_COMPONENT16'),
    [smoke] = scene()
  run([smoke])
  assert.equal(particles.draw([smoke], createHostDrawCamera(), output), 0, 'nothing thrown')
  assert.deepEqual(depths(ctx.of), ['DEPTH24_STENCIL8', 'DEPTH_COMPONENT24'], 'both probed')
  assert.equal(ctx.of('drawArraysInstanced').length, 0, 'no particle without its soft edge')
  assert.equal(heard.length, 1)
  assert.match(heard[0], /^PARTICLES_UNSUPPORTED: .*depth it cannot copy/)
  run([smoke])
  particles.draw([smoke], createHostDrawCamera(), output)
  assert.deepEqual([smoke.refused, heard.length], [true, 1], 'the next step keeps them, told once')
})
