// #347: the diffuse alpha is multiplied by the vertex colour's before the alpha test,
// so a masked surface that reads its vertex colours is cut at base map alpha × vertex alpha. The
// rasters did read the base map alone.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { VIS_SHADER } from './shader/visShader.fixture.ts'
import { camera, centerId, nearestQuadTexture, quadPages } from './buffer.fixture.ts'
import { engineCamera } from '../camera/camera.fixture.ts'
import { maskKeepWgsl } from './shader/pageWgsl.ts'
import { maskAlphaWgsl } from '../materials/virtual/wgsl.ts'
import { PAGE_GEOMETRY_WGSL } from './shader/pageGeometryWgsl.ts'
import { rasterSource } from './raster/shader.ts'
import { FLAG_HAS_COLOR, FLAG_SAMPLED } from './types.ts'
import { identityRoots } from '../geometry/selection/placements.fixture.ts'
import { rasterVisibilityIds } from '../../../../bench/oracles/browser/cpu-image/raster.ts'
import { unpackVisibilityId } from '../../../../bench/oracles/browser/cpu-image/ids.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'

/** The cutout's own text, the camera's: its two variants differ only by the `maskAlpha` they list. */
const MASK_KEEP = maskKeepWgsl(maskAlphaWgsl(false)).text

/** Whether the centre of a quad of vertex alpha `alpha` survives the CPU raster. */
function covered(options: {
  vertexColors: boolean
  map: boolean
  alpha: number
  opacity?: number
}) {
  const map = options.map ? nearestQuadTexture() : null
  const { vertexColors, opacity = 1 } = options
  const surface = G.basicSurface({ map, alphaTest: 0.5, vertexColors, opacity })
  const { pages, geometry } = quadPages(surface, [0, 0, 1, 0, 1, 1, 0, 1])
  geometry.setAttribute(
    'color',
    G.floatAttribute(Array(4).fill([1, 1, 1, options.alpha]).flat(), 4),
  )
  const ids = rasterVisibilityIds(pages, identityRoots(), engineCamera(camera()), [16, 16])
  geometry.dispose()
  surface.dispose()
  map?.dispose()
  return unpackVisibilityId(centerId(ids, 16, 16)) !== null
}

test('the CPU raster cuts a masked surface at base map alpha times vertex alpha', () => {
  // The map is opaque everywhere: only the vertex alpha can cut.
  assert.equal(covered({ vertexColors: true, map: true, alpha: 0.2 }), false)
  assert.equal(covered({ vertexColors: true, map: true, alpha: 0.8 }), true)
  assert.equal(covered({ vertexColors: false, map: true, alpha: 0.2 }), true, 'material says no')
  // Without a base map the vertex alpha cuts alone, and a material that reads none keeps it all.
  assert.equal(covered({ vertexColors: true, map: false, alpha: 0.2 }), false)
  assert.equal(covered({ vertexColors: false, map: false, alpha: 0.2 }), true)
})

// #748: glTF 2.0 cuts the base colour's alpha, the factor's times the map's; the cutout read the
// map's alone.
test('a masked surface is cut at its opacity times its map alpha, in both raster tests', () => {
  assert.equal(covered({ vertexColors: false, map: true, alpha: 1, opacity: 0.4 }), false)
  assert.equal(covered({ vertexColors: true, map: false, alpha: 1, opacity: 0.4 }), false)
  assert.equal(covered({ vertexColors: false, map: true, alpha: 1, opacity: 0.6 }), true)
  assert.equal(covered({ vertexColors: false, map: false, alpha: 1, opacity: 0.4 }), false)
  assert.ok(MASK_KEEP.includes(`(page.flags&${FLAG_SAMPLED}u)!=0u)*coverage;`))
  assert.ok(MASK_KEEP.includes('let coverage=saturate(m.opacity);'))
})

test('the cutout multiplies by the vertex alpha only on a row that reads its colours', () => {
  const keep = MASK_KEEP.replace(/\s+\/\/[^\n]*/g, '')
  assert.match(keep, /fn maskKeep\(page:PageInfo,uv:vec2f,vertexAlpha:f32,/)
  assert.ok(keep.includes(`let coloured=(page.flags&${FLAG_HAS_COLOR}u)!=0u;`))
  assert.ok(
    keep.includes(
      'if((page.flags&8u)==0u){return select(1.0,vertexAlpha,coloured)*coverage>=m.cut;}',
    ),
  )
  const read = keep.indexOf('var alpha=maskAlpha(')
  const multiply = keep.indexOf('if(coloured){alpha*=vertexAlpha;}')
  assert.ok(read > 0 && multiply > read && multiply < keep.indexOf('return alpha>=m.cut;'))
  assert.ok(
    wgslModule(PAGE_GEOMETRY_WGSL).includes(
      `if((page.flags&${FLAG_HAS_COLOR}u)!=0u){return pageColor(page,h,vertex).w;}`,
    ),
  )
})

test('both rasters hand the interpolated vertex alpha to the cutout; shadows pass one', () => {
  assert.ok(VIS_SHADER.includes('@location(2) tc:vec3f,'), 'one interpolant with the UV')
  assert.equal(
    VIS_SHADER.split('if((page.flags&128u)!=0u){out.tc.z=pageMaskAlpha(page,h,id);}').length,
    2,
    'the one vertex stage, both halves drawn by it',
  )
  // One camera fragment stage cuts, in both phases of the visibility write.
  assert.equal(VIS_SHADER.split('maskKeep(page,in.tc.xy,in.tc.z,').length, 2)
  const small = rasterSource()
  assert.ok(small.includes('t.ua=vec3f(pageMaskUv(page,h,k.x),pageMaskAlpha(page,h,k.x));'))
  // Interpolated with the UV by the setup's one cutout reading (`triCutout`), which the shadow
  // maps' software raster reads too.
  assert.ok(small.includes('t.ua*uvw.x+t.ub*uvw.y+t.uc*uvw.z'), 'interpolated with the UV')
  assert.ok(small.includes('let cut=triCutout(t,c);'))
  assert.ok(small.includes('maskKeep(page,tc.xy,tc.z,ddx,ddy)'))
})
