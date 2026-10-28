// The cutout is the hard threshold in every raster and every image. A stippled threshold would turn
// the leaves of a still, temporally antialiased image into blotches; nothing reads a stipple word.
import test from 'node:test'
import assert from 'node:assert/strict'
import { maskKeepWgsl } from './pageWgsl.ts'
import { maskAlphaWgsl } from '../../materials/virtual/wgsl.ts'
import { visShader } from './visWgsl.ts'
import { VIS_SHADER } from './visShader.fixture.ts'
import { ENGINE_SHADERS } from '../../gpu/core/engineShaders.fixture.ts'
import { FLAG_HAS_COLOR, FLAG_SAMPLED } from '../types.ts'
import { COLOR_SAMPLE_WGSL } from '../../materials/virtual/wgsl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { maskClipValue, maskSetOf } from '../../materials/graph/maskProgram.ts'
import { graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { GRAPH_HEADER } from '../../materials/table/materialLayout.ts'
import { DITHER_MODEL_BIT } from '../../materials/surface/surfaceModelWord.ts'
import { VIS_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { cameraMasks } from './maskSets.ts'
import { NO_RASTERS } from '../../materials/graph/graphRasters.ts'
import type { PixelProgram } from '../../materials/graph/pixelProgram.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'

test('the cutout is the hard threshold: the mask test, with the dash, vertex alpha and opacity', () => {
  // The mask test reads `maskAlpha(...)>=m.cut` after the flag test, its surface's record read
  // once. A dashed line's gaps cut it, the vertex alpha multiplies it and the colour factor's
  // opacity, saturated, does too; nothing else may stand between the read and the threshold.
  assert.equal(
    maskKeepWgsl(maskAlphaWgsl(false)).text.replace(/\n *\/\/[^\n]*/g, ''),
    `fn maskKeep(page:PageInfo,uv:vec2f,vertexAlpha:f32,ddx:vec2f,ddy:vec2f)->bool{
 if((page.flags&128u)==0u){return true;}
 let m=materialAt(page.material);
 if(!lineDash(uv.x,m.dash)){return false;}
 if(m.cut<=0.0){return true;}
 let coverage=saturate(m.opacity);
 let coloured=(page.flags&${FLAG_HAS_COLOR}u)!=0u;
 if((page.flags&8u)==0u){return select(1.0,vertexAlpha,coloured)*coverage>=m.cut;}
 var alpha=maskAlpha(m.mapIndex,uv,ddx,ddy,(page.flags&${FLAG_SAMPLED}u)!=0u)*coverage;
 if(coloured){alpha*=vertexAlpha;}
 return alpha>=m.cut;
}`,
  )
})

test('every raster calls it as before the stipple, and no shader reads a stipple', () => {
  // The call sites themselves are pinned by `maskVertexAlpha.test.ts`. Hardware raster: the
  // fragment's own derivatives, taken while every lane of the quad runs, in its one cutting stage.
  // Software raster: the cutout read at the perspective-correct weights, its footprint the weights'
  // screen steps, read by the setup's one cutout reading (`triCutout`, which the shadow maps'
  // software raster reads too) in `RASTER_PIXEL_WGSL`.
  assert.equal(VIS_SHADER.split('if(MASKED){gx=dpdx(in.tc.xy);gy=dpdy(in.tc.xy);}').length, 2)
  assert.match(ENGINE_SHADERS.RASTER!, /\(t\.ua\*t\.dx\.x\+t\.ub\*t\.dx\.y\+t\.uc\*t\.dx\.z\)\.xy/)
  assert.match(
    ENGINE_SHADERS.RASTER!,
    /let cut=triCutout\(t,c\);\s*let tc=cut\.at;let ddx=cut\.ddx;let ddy=cut\.ddy;/,
  )
  assert.match(ENGINE_SHADERS.RASTER!, /maskKeep\(page,tc\.xy,tc\.z,ddx,ddy\)/)
  for (const [name, source] of Object.entries(ENGINE_SHADERS))
    assert.doesNotMatch(source, /stipple/i, name)
})

/** The graph of a mask that is the first texture coordinate's u: kept past the clip value. */
function rampMask() {
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output('opacityMask', g.componentMask(g.texCoord(0), 'r'))
  const mask = graphRastersOf([{ graph: g }]).pixelPrograms[0]
  assert.ok(mask, 'the mask compiles')
  return mask
}

/** What the run of a module is given of the surface and the image. */
interface MaskWorld {
  /** The header's program id (the module's by default) and bits, the record's dither bit, the wall
   *  clock, the view's image number (`GraphFrame.frame`), whether the noise is bound. */
  program?: number
  flags?: number
  dither?: boolean
  realTime?: number
  frame?: number
  noise?: boolean
}

/** The blue noise the runs read: a number of the pixel and the frame, in tenths. */
const noiseAt = (coord: number[], frame: number) =>
  ((coord[0]! * 7 + coord[1]! * 3 + frame) % 10) / 10

/** `maskKeepAt` run in JavaScript over a record whose mask is `mask`, its clip value `cut`, in the
 *  image `world` says (the graph frame, the blue noise). */
function runMask(mask: PixelProgram, cut: number, world: MaskWorld = {}) {
  const {
    program = mask.key,
    flags = GRAPH_HEADER.mask,
    dither = false,
    realTime = 0,
    frame = 0,
    noise = true,
  } = world
  const keep = maskKeepWgsl(
    maskAlphaWgsl(false),
    maskSetOf([mask], VIS_BINDINGS.frame, COLOR_SAMPLE_WGSL, '1.0', VIS_BINDINGS.noise),
  )
  const run = shaderRun<{
    maskKeepAt: (...args: unknown[]) => boolean
    maskKeep: (...args: unknown[]) => boolean
  }>(keep, ['maskKeepAt', 'maskKeep'], {
    materialAt: () => ({
      graph: 1,
      cut,
      dash: [0, 0],
      opacity: 1,
      mapIndex: 0,
      model: dither ? DITHER_MODEL_BIT : 0,
    }),
    materialTableRecord: () => [program, flags, 0, 0],
    maskAlpha: () => 1,
    graphFrame: {
      clock: [0, realTime, 0, 0],
      eye: [0, 0, 0, noise ? 1 : 0],
      before: [0, 0, 0],
      frame,
    },
    blueNoiseScalar: noiseAt,
  })
  const page = { flags: 128, material: 0 }
  return {
    at: (u: number, pixel = [-1, -1]) => run.maskKeepAt(page, [u, 0], 1, [0, 0], [0, 0], pixel),
    plain: (u: number) => run.maskKeep(page, [u, 0], 1, [0, 0], [0, 0]),
  }
}

test('a graph mask cuts the row where its output is below the clip value, in the module that holds it', () => {
  const mask = rampMask()
  const run = runMask(mask, 0.5)
  assert.deepEqual([0.3, 0.5, 0.7].map(run.plain), [false, true, true])
  assert.deepEqual(
    [0.3, 0.5, 0.7].map((u) => run.at(u)),
    [false, true, true],
  )
  // A program the module does not hold keeps the row whole; so does a header of no mask, whose
  // program id may be the same number (the transparent pass's programs count from one too).
  assert.equal(runMask(mask, 0.5, { program: mask.key + 100 }).plain(0.1), true)
  assert.equal(runMask(mask, 0.5, { flags: 0 }).plain(0.1), true)
  // The record's cut is the clip value: the same mask, another clip.
  assert.deepEqual([0.3, 0.5, 0.7].map(runMask(mask, 0.6).plain), [false, false, true])
  // A clip value of zero or below is a value: the mask is kept where it is not below it.
  assert.deepEqual([0.3, 0.5].map(runMask(mask, 0).plain), [true, true])
  assert.deepEqual([-0.3, 0.1].map(runMask(mask, -0.2).plain), [false, true])
})

test('the clip value is the one the material names, else its alpha test, else 0.3333', () => {
  assert.equal(maskClipValue({}), 0.3333)
  assert.equal(maskClipValue({ alphaTest: 0 }), 0.3333)
  assert.equal(maskClipValue({ alphaTest: 0.5 }), 0.5, 'a glTF material keeps its alpha cutoff')
  assert.equal(maskClipValue({ alphaTest: 0.5, opacityMaskClipValue: 0.2 }), 0.2)
  assert.equal(maskClipValue({ opacityMaskClipValue: 0 }), 0)
  assert.equal(maskClipValue({ opacityMaskClipValue: -0.2 }), -0.2)
})

test('a dithered mask keeps a pixel by the blue noise at it and the image’s frame; no pixel, no dither; the switch is the record’s', () => {
  const mask = rampMask()
  // At the clip value itself the coverage is 0.83 · noise − 0.5, kept from a noise of 0.602.
  const pixels = Array.from({ length: 40 }, (_, i) => [i * 7 + 0.5, i * 3 + 0.5] as const)
  const expected = (frame: number) =>
    pixels.map(([x, y]) => noiseAt([Math.trunc(x), Math.trunc(y)], frame) >= 0.5 / 0.83)
  assert.ok(expected(60).some(Boolean) && !expected(60).every(Boolean), 'the pixels split in both')
  // The noise is walked by the view's image number, not by the wall clock.
  for (const frame of [60, 75]) {
    const dithered = runMask(mask, 0.5, { dither: true, realTime: 1, frame })
    assert.deepEqual(
      pixels.map(([x, y]) => dithered.at(0.5, [x, y])),
      expected(frame),
    )
  }
  const dithered = runMask(mask, 0.5, { dither: true, realTime: 1 })
  assert.equal(dithered.at(0.5), true, 'a caller that gives no pixel gets the hard threshold')
  const hard = runMask(mask, 0.5, { realTime: 1 })
  assert.ok(
    pixels.every(([x, y]) => hard.at(0.5, [x, y])),
    'the record says no dither',
  )
  const unbound = runMask(mask, 0.5, { dither: true, realTime: 1, noise: false })
  assert.ok(
    pixels.every(([x, y]) => unbound.at(0.5, [x, y])),
    'a pass without the noise cuts plain',
  )
})

test('a masked surface with no graph dithers its cutout as well, the switch being the material’s', () => {
  const keep = maskKeepWgsl(
    maskAlphaWgsl(false),
    maskSetOf([], VIS_BINDINGS.frame, COLOR_SAMPLE_WGSL, '1.0', VIS_BINDINGS.noise),
  )
  const world = (dither: boolean) =>
    shaderRun<{ maskKeepAt: (...args: unknown[]) => boolean }>(keep, ['maskKeepAt'], {
      materialAt: () => ({
        graph: 0,
        cut: 0.5,
        dash: [0, 0],
        opacity: 1,
        mapIndex: 0,
        model: dither ? DITHER_MODEL_BIT : 0,
      }),
      maskAlpha: () => 0.5,
      // The wall clock stands at one second: the noise is walked by the view's image number, not by it.
      graphFrame: { clock: [0, 1, 0, 0], eye: [0, 0, 0, 1], before: [0, 0, 0], frame: 7 },
      blueNoiseScalar: noiseAt,
    })
  const page = { flags: 128 | 8, material: 0 }
  const kept = (dither: boolean, x: number, y: number) =>
    world(dither).maskKeepAt(page, [0, 0], 1, [0, 0], [0, 0], [x + 0.5, y + 0.5])
  const pixels = Array.from({ length: 30 }, (_, i) => [i * 5, i * 2] as const)
  assert.ok(
    pixels.every(([x, y]) => kept(false, x, y)),
    'the alpha at the threshold is kept',
  )
  assert.deepEqual(
    pixels.map(([x, y]) => kept(true, x, y)),
    pixels.map(([x, y]) => noiseAt([x, y], 7) >= 0.5 / 0.83),
  )
})

test('every raster holds the graph masks it is made with, and none holds them otherwise', () => {
  const names = [
    'VIS_MASKED',
    'VIS_MASKED_CLIP_PIXEL',
    'RASTER_MASKED',
    'TESSELLATION_DICE_MASKED',
    'VSM_RENDER_RASTER_MASKED',
    'VSM_TESSELLATION_DICE_MASKED_GRAPH',
  ]
  for (const name of names) {
    const text = ENGINE_SHADERS[name]!
    assert.match(text, /fn maskGraphValue\(m:Material,uv:vec2f,ddx:vec2f,ddy:vec2f\)->f32/, name)
    assert.match(
      text,
      /switch\(head\.x\)\{\s*case \d+u:\{return maskGraph_\w+\(m\.graph-1u,m\.cut,uv,ddx,ddy\);\}/,
      name,
    )
  }
  // The passes that cut pixels and have the blue noise give the pixel and dither; the dicing and the
  // shadow patches judge a point, whose stage sees no noise.
  const dithered =
    /if\(m\.graph!=0u\)\{return maskDithered\(m,maskGraphValue\(m,uv,ddx,ddy\),pixel\)>=0\.0;\}/
  const plain = /if\(m\.graph!=0u\)\{return maskGraphValue\(m,uv,ddx,ddy\)>=0\.0;\}/
  for (const name of [
    'VIS_MASKED',
    'VIS_MASKED_CLIP_PIXEL',
    'RASTER_MASKED',
    'VSM_RENDER_RASTER_MASKED',
  ])
    assert.match(ENGINE_SHADERS[name]!, dithered, name)
  for (const name of ['TESSELLATION_DICE_MASKED', 'VSM_TESSELLATION_DICE_MASKED_GRAPH'])
    assert.match(ENGINE_SHADERS[name]!, plain, name)
  assert.ok(
    ENGINE_SHADERS.VIS_MASKED!.includes('maskKeepAt(page,in.tc.xy,in.tc.z,gx,gy,in.position.xy)'),
  )
  assert.match(
    ENGINE_SHADERS.RASTER_MASKED!,
    /maskKeepAt\(page,tc\.xy,tc\.z,ddx,ddy,vec2f\(pixel\)\+vec2f\(0\.5\)\)/,
  )
  // The shadow raster gives the map's virtual pixel, which the dither is read at.
  assert.match(
    ENGINE_SHADERS.VSM_RENDER_RASTER_MASKED!,
    /maskKeepAt\(pages\[in\.row\],in\.uv,1\.0,gx,gy,vsmRenderMapPixel\(in\.clip,vsmRenderWindowMip\(in\.window\)\)\)/,
  )
  assert.match(
    ENGINE_SHADERS.TESSELLATION_DICE_MASKED!,
    /return maskKeep\(page,uv\*at\.b,dot\(alpha,at\.b\),vec2f\(m\),vec2f\(m\)\);/,
  )
  // A diced vertex whose mask is below zero is as one behind the camera: the micro-triangles that
  // use it are not drawn.
  assert.match(
    ENGINE_SHADERS.TESSELLATION_DICE_MASKED!,
    /let kept=!masked\|\|dicedKept\([^\n]*\n\s*usable\[v\]=select\(0u,1u,kept&&\(item\.near!=0u\|\|\(clip\.w>0\.0&&sub\.z<=1\.0\)\)\);/,
  )
  for (const name of [
    'VIS_SHADER',
    'RASTER',
    'TESSELLATION_DICE',
    'VSM_RENDER_RASTER',
    'VSM_TESSELLATION_DICE',
  ])
    assert.doesNotMatch(ENGINE_SHADERS[name]!, /maskGraph|maskKeepAt/, name)
  // The camera's passes read a texture at the render pixel's footprint, the shadows' at no offset.
  assert.match(ENGINE_SHADERS.VIS_MASKED!, /let stepX=ddx\*exp2\(-uni\.mipBias\);/)
  assert.match(ENGINE_SHADERS.VSM_RENDER_RASTER_MASKED!, /let stepX=ddx\*1\.0;/)
})

test('the session’s camera passes carry the dither whatever graphs they hold: a masked material asks it', () => {
  const text = visShader({ masks: cameraMasks(NO_RASTERS) })
  assert.match(text, /fn maskDithered\(m:Material,value:f32,pixel:vec2f\)->f32/)
  assert.match(text, /maskKeepAt\(page,in\.tc\.xy,in\.tc\.z,gx,gy,in\.position\.xy\)/)
  assert.doesNotMatch(text, /maskGraphValue/, 'and no graph function when it holds no graph')
})
