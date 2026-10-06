import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts'
import { TILE_POOL_WGSL, tilePoolWgsl } from './wgsl.ts'
import { TILE_REQUEST_WGSL } from './requestWgsl.ts'
import { upscaleMipBias } from '../../taa/jitter.ts'

type Vec = { x: number; y: number }
type Lod = { atlasLod: (px: Vec, py: Vec) => number }

/** The body of the WGSL function `name` in `source`, from its header to the next one. */
const body = (source: string, name: string) => {
  const start = source.indexOf(`fn ${name}(`)
  assert.ok(start >= 0, `no function ${name}`)
  return source.slice(start, source.indexOf('\nfn ', start + 1))
}

// #816: a frame drawn below the display reads its textures at the display's texel density.
test('every texture level, read or asked, adds the frame offset: zero at native size', () => {
  const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y
  const lodAt = (bias: number) =>
    shaderFunctions<Lod>(tilePoolWgsl('bias'), ['atlasLod'], { dot, log2: Math.log2, bias })
      .atlasLod
  // A footprint of four texels per render pixel: level 2 at native size.
  const px = { x: 4, y: 0 },
    py = { x: 0, y: 4 }
  assert.equal(lodAt(upscaleMipBias(3456, 3456))(px, py), 2)
  // Drawn at half the display, a render pixel covers two display pixels: one level finer.
  assert.equal(lodAt(upscaleMipBias(1728, 3456))(px, py), 1)
  // The one rule: the read's level (`tileRead`) and the request's (`slotLod`, or the read's own
  // footprint) both come from `atlasLod`, so the tiles asked are the tiles read.
  assert.match(body(TILE_POOL_WGSL, 'slotLod'), /atlasLod\(/)
  assert.match(body(TILE_POOL_WGSL, 'tileRead'), /atlasLod\(/)
  const request = body(TILE_REQUEST_WGSL, 'colorRequestIndex')
  assert.match(request, /Footprint\(slot,s,uv,ddx,ddy,aniso\)/)
  assert.match(request, /lod=slotLod\(s,ddx,ddy\)/)
  // The camera passes read the offset from their uniform.
  assert.match(body(TILE_POOL_WGSL, 'atlasLod'), /\+uni\.mipBias;\}/)
})
