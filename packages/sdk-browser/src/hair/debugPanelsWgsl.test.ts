// The text of the debug views' programs: what they read and where the lines go.
import test from 'node:test'
import assert from 'node:assert/strict'
import { DEBUG_CPU_LINES } from './debugLines.ts'
import { DEBUG_GPU_LINES, DEBUG_LINES_DRAW_WGSL, DEBUG_LINES_GPU_WGSL } from './debugLinesWgsl.ts'
import { DEBUG_ATLAS_WGSL, debugVoxelWgsl } from './debugPanelsWgsl.ts'
import { voxelTraversalWgsl } from './voxelTraversalWgsl.ts'

test("the lines the GPU writes follow the host's, one region for each kind of box", () => {
  assert.equal(DEBUG_GPU_LINES.frusta, DEBUG_CPU_LINES)
  assert.ok(DEBUG_GPU_LINES.macro > DEBUG_GPU_LINES.frusta)
  assert.ok(DEBUG_GPU_LINES.nodes > DEBUG_GPU_LINES.macro)
  assert.ok(DEBUG_GPU_LINES.end > DEBUG_GPU_LINES.nodes)
  for (const name of ['debugFrusta', 'debugMacroBoxes', 'debugNodeBoxes'])
    assert.match(DEBUG_LINES_GPU_WGSL, new RegExp(`fn ${name}\\(`))
})

test('a line behind the camera is brought to the near plane and a line of no length is not drawn', () => {
  assert.match(DEBUG_LINES_DRAW_WGSL, /if\(ha\.w<=NEAR_W&&hb\.w<=NEAR_W\)\{return out;\}/)
  assert.match(DEBUG_LINES_DRAW_WGSL, /if\(!\(span>0\.0001\)\)\{return out;\}/)
})

test('the atlases are drawn in two squares with a yellow border and the layers divided by the scale', () => {
  assert.match(DEBUG_ATLAS_WGSL, /DEPTH_RECT=vec4f\(450\.0,50\.0,300\.0,300\.0\)/)
  assert.match(DEBUG_ATLAS_WGSL, /LAYERS_RECT=vec4f\(750\.0,50\.0,300\.0,300\.0\)/)
  assert.match(DEBUG_ATLAS_WGSL, /bilinearLayers\(.*\)\/atlas\.scale/)
})

test('the voxel view marches the volume with the level forced, the linear or the mip traversal', () => {
  for (const mipmap of [false, true]) {
    const code = debugVoxelWgsl(mipmap)
    assert.match(code, /var<private> forcedMip:i32=-1;/)
    assert.match(code, /forcedMip=settings\.forcedMip;/)
    assert.match(code, /traceVoxels\(origin,surfacePoint,node,TraversalSettings\(/)
  }
  assert.match(debugVoxelWgsl(true), /stepScale=min/)
  assert.doesNotMatch(debugVoxelWgsl(false), /stepScale=min/)
})

test('the traversal the other passes use has no forced level', () => {
  assert.doesNotMatch(voxelTraversalWgsl(true).text, /forcedMip/)
  assert.match(
    voxelTraversalWgsl(false, true).text,
    /if\(forcedMip>=0\)\{level=min\(u32\(forcedMip\),lastLevel\);\}/,
  )
})
