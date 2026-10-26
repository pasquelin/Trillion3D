// The graph outputs the rasters evaluate beside the cutout: the depth a pixel is written at
// (`pixelDepthOffset`, `pdoProgram.ts`) and the height the dicing displaces by (`displacement`,
// `displacementProgram.ts`), joined into the one pixel program (`pixelProgram.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { visShader } from './visWgsl.ts'
import { COLOR_SAMPLE_WGSL } from '../../materials/virtual/wgsl.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { maskSetOf } from '../../materials/graph/maskProgram.ts'
import { graphRastersOf, NO_RASTERS } from '../../materials/graph/graphRasters.ts'
import { cameraMasks } from './maskSets.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'

test('a graph that wires a pixelDepthOffset gives the rasters the depth of its pixels: the software raster and the hardware fragment write the offset depth, a module with none writes the plane’s', async () => {
  const { rasterPixelWgsl } = await import('../raster/pixelWgsl.ts')
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output('pixelDepthOffset', g.componentMask(g.texCoord(0), 'r'))
  const masks = cameraMasks(graphRastersOf([{ graph: g }]))
  assert.equal(masks.programs.length, 1, 'the program joins the pixel programs')
  assert.ok(
    masks.programs[0]!.depthOffsets && !masks.programs[0]!.cuts,
    'it offsets and cuts nothing',
  )
  const software = rasterPixelWgsl(masks).text
  assert.match(software, /let moved=\(page\.flags&134217728u\)!=0u;/)
  assert.match(software, /key=visKey\(offsetDepth\(plane,w,push,/)
  // A row that moves its depth reads its early-out after the offset, any other before the cutout.
  assert.match(software, /if\(!moved&&!visPasses\(offset,key,ids\)\)\{return;\}/)
  const plain = rasterPixelWgsl(cameraMasks(NO_RASTERS)).text
  assert.doesNotMatch(plain, /offsetDepth|moved/)
  const hardware = visShader({ masks, wide: true })
  assert.match(hardware, /z=offsetDepth\(z,1\.0\/in\.position\.w,depthOffsetValue\(/)
  assert.match(hardware, /visKey\(z,page\.depthBias\)/)
  assert.doesNotMatch(visShader({ wide: true }), /offsetDepth/)
})

test('the offset depth pushes a pixel away along the camera vector and never brings it nearer', async () => {
  const { OFFSET_DEPTH_WGSL } = await import('../raster/pixelWgsl.ts')
  const run = (uni: object) =>
    shaderRun<{ offsetDepth: (...args: unknown[]) => number }>(OFFSET_DEPTH_WGSL, ['offsetDepth'], {
      uni,
    }).offsetDepth
  // A perspective view, the reversed infinite depth: depth = near / w, here near 1, w 10.
  const view = { depthSpan: 0, viewport: [100, 100], focal: [1, 1] }
  const centre = run(view)(0.1, 10, 5, [50, 50])
  assert.ok(Math.abs(centre - 1 / 15) < 1e-6, `1 / (10 + 5), got ${centre}`)
  // Off the axis the offset counts less along the view axis: the pixel moves less.
  const edge = run(view)(0.1, 10, 5, [100, 50])
  assert.ok(edge > centre && edge < 0.1, `${edge}`)
  // A negative offset never moves it nearer; none leaves its depth.
  assert.equal(run(view)(0.1, 10, -3, [50, 50]), 0.1)
  assert.equal(run(view)(0.1, 10, 0, [50, 50]), 0.1)
  // An orthographic view's depth is affine: the offset over the span is taken off.
  const ortho = run({ ...view, depthSpan: 100 })(0.6, 1, 10, [50, 50])
  assert.ok(Math.abs(ortho - 0.5) < 1e-6, `${ortho}`)
})

test('the dicing reads the height where a graph gives it: one `diceHeight`, the map’s unless the surface’s record names a graph', async () => {
  const { diceSource } = await import('../tessellation/diceWgsl.ts')
  const count = (text: string) => text.match(/fn diceHeight\(/g)?.length ?? 0
  const plain = diceSource()
  assert.equal(count(plain), 1)
  assert.doesNotMatch(plain, /displacementValue/)
  const g = material.graph('surface')
  g.output('baseColor', g.constant(1, 0, 0))
  g.output('displacement', g.componentMask(g.texCoord(0), 'r'))
  const masks = maskSetOf(graphRastersOf([{ graph: g }]).pixelPrograms, 0, COLOR_SAMPLE_WGSL, '1.0')
  assert.ok(masks.programs[0]!.displaces)
  const graphed = diceSource(masks)
  assert.equal(count(graphed), 1, 'the graph’s read replaces the default, never joins it')
  assert.match(
    graphed,
    /if\(rec\.map\.z!=0u\)\{return displacementValue\(materialAt\(rec\.map\.w\)/,
  )
  assert.match(graphed, /fn displacementValue\(m:Material/)
})
