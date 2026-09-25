// #347: the reference multiplies the diffuse alpha by the vertex colour's before its alpha test,
// so a masked surface that reads its vertex colours is cut at base map alpha × vertex alpha. The
// rasters did read the base map alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../host/graph/graph.fixture.ts';
import { rasterVisibilityIds, unpackVisibilityId, VIS_SHADER } from './buffer.ts';
import { camera, centerId, nearestQuadTexture, quadPages } from './buffer.fixture.ts';
import { cameraMoteur } from '../camera/camera.fixture.ts';
import { MASK_KEEP_WGSL } from './shader/pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL } from './shader/pageGeometryWgsl.ts';
import { rasterSource } from '../gpu/raster/shader.ts';
import { SHADOW_DEPTH_SHADER } from '../gpu/shadow/shader.ts';
import { FLAG_HAS_COLOR } from './types.ts';
import { CLUSTER_FRAGMENT } from '../webgl/cluster/shaders.ts';

/** Whether the centre of a quad of vertex alpha `alpha` survives the CPU raster. */
function covered(options: { vertexColors: boolean; map: boolean; alpha: number }) {
  const map = options.map ? nearestQuadTexture() : null;
  const surface = G.basicSurface({ map, alphaTest: 0.5, vertexColors: options.vertexColors });
  const { pages, geometry } = quadPages(surface, [0, 0, 1, 0, 1, 1, 0, 1]);
  geometry.setAttribute(
    'color',
    G.floatAttribute(Array(4).fill([1, 1, 1, options.alpha]).flat(), 4),
  );
  const ids = rasterVisibilityIds(pages, cameraMoteur(camera()), [16, 16]);
  geometry.dispose();
  surface.dispose();
  map?.dispose();
  return unpackVisibilityId(centerId(ids, 16, 16)) !== null;
}

test('the CPU raster cuts a masked surface at base map alpha times vertex alpha', () => {
  // The map is opaque everywhere: only the vertex alpha can cut.
  assert.equal(covered({ vertexColors: true, map: true, alpha: 0.2 }), false);
  assert.equal(covered({ vertexColors: true, map: true, alpha: 0.8 }), true);
  assert.equal(covered({ vertexColors: false, map: true, alpha: 0.2 }), true, 'material says no');
  // Without a base map the vertex alpha cuts alone, and a material that reads none keeps it all.
  assert.equal(covered({ vertexColors: true, map: false, alpha: 0.2 }), false);
  assert.equal(covered({ vertexColors: false, map: false, alpha: 0.2 }), true);
});

test('the cutout multiplies by the vertex alpha only on a row that reads its colours', () => {
  const keep = MASK_KEEP_WGSL.replace(/\s+\/\/[^\n]*/g, '');
  assert.match(keep, /fn maskKeep\(page:PageInfo,uv:vec2f,vertexAlpha:f32,/);
  assert.ok(keep.includes(`let coloured=(page.flags&${FLAG_HAS_COLOR}u)!=0u;`));
  assert.ok(
    keep.includes('if((page.flags&8u)==0u){return !coloured||vertexAlpha>=page.baseColor.w;}'),
  );
  const read = keep.indexOf('var alpha=maskAlpha(');
  const multiply = keep.indexOf('if(coloured){alpha*=vertexAlpha;}');
  assert.ok(read > 0 && multiply > read && multiply < keep.indexOf('if(stipple==0.0)'));
  assert.ok(
    PAGE_GEOMETRY_WGSL.includes(
      `if((page.flags&${FLAG_HAS_COLOR}u)!=0u){return pageColor(page,h,vertex).w;}`,
    ),
  );
});

test('both WebGPU rasters hand the interpolated vertex alpha to the cutout; shadows pass one', () => {
  assert.ok(VIS_SHADER.includes('@location(2) tc:vec3f,}'), 'one interpolant with the UV');
  assert.equal(
    VIS_SHADER.split('if((page.flags&128u)!=0u){out.tc.z=pageMaskAlpha(page,h,id);}').length,
    3,
    'both vertex stages',
  );
  assert.equal(VIS_SHADER.split('maskKeep(pages[in.instance],in.tc.xy,in.tc.z,').length, 3);
  const small = rasterSource(4, 16);
  assert.ok(small.includes('ua=vec3f(pageUv(page,h,ia),pageMaskAlpha(page,h,ia));'));
  assert.ok(small.includes('u:array<vec3f,4>'), 'the near clip carries it');
  assert.ok(small.includes('if(!maskKeep(page,tc.xy,tc.z,gx,gy,stipple)){return;}'));
  assert.ok(SHADOW_DEPTH_SHADER.includes('maskKeep(pages[in.instance],in.uv,1.0,gx,gy,0.0)'));
});

test('WebGL2 cuts at the same product: vertex colour first, then the alpha test', () => {
  assert.ok(
    CLUSTER_FRAGMENT.includes('if(hasVertexColor)base*=vertexColor;if(base.a<alphaCutoff)discard;'),
  );
});
