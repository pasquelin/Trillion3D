import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { pixelToNdc } from '../../../../../math/src/wgsl/projection.ts'
import { clampToExtent } from '../../../../../math/src/wgsl/sampling.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { DFAO_GRID_WGSL } from './gridWgsl.ts'
import { DFAO_BINDING as B } from './layout.ts'

/**
 * THE GEOMETRY-AWARE UPSAMPLE (`dfaoUpsample`) of the cones' bent normals to the grid: for the grid cell `texel`, the
 * four cone-grid cells round it (the cone grid's jitter taken back) weighed by their bilinear share, by how far
 * their surface's plane — the cell's own, from its normal and position — is from where their depth puts them
 * (`10 / (1000 · |plane distance| / depth)`, at most one), and by how well their normal agrees with the cell's
 * (the dot product, at least 0.0001). The weights sum to at least 0.00001; the cell is written with its own scene
 * depth in the alpha. `dfaoViewNdc` is a position in cells of the grid as the view's device coordinates, the
 * view being the grid's first `dfao.grid.zw / 2` cells.
 */
export const DFAO_UPSAMPLE_WGSL = wgslBlock(
  'DFAO_UPSAMPLE_WGSL',
  [DFAO_COMMON_WGSL, DFAO_GRID_WGSL, pixelToNdc, clampToExtent],
  `@group(0) @binding(${B.bent}) var coneBent:texture_2d<f32>;
fn dfaoViewNdc(cells:vec2f)->vec2f{return pixelToNdc(cells,floor(vec2f(dfao.grid.zw)*0.5));}
fn dfaoConeBent(cell:vec2i)->vec4f{
 return textureLoad(coneBent,clampToExtent(cell,vec2i(dfao.cones.xy)),0);
}
fn dfaoPositionWeight(plane:vec4f,cells:vec2f,depth:f32)->f32{
 let p=dfaoWorldAt(dfaoViewNdc(cells),depth);
 let relative=1000.0*abs(dot(plane,vec4f(p,1.0)))/depth;
 return min(10.0/(relative+0.0001),1.0);
}
fn dfaoNormalWeight(uv:vec2f,normal:vec3f)->f32{
 let texel=vec2i(floor(uv*vec2f(dfao.grid.xy)));
 return max(dot(dfaoGrid(texel).xyz,normal),0.0001);
}
fn dfaoUpsample(texel:vec2u)->vec4f{
 let surface=dfaoGrid(vec2i(texel));
 let grid=vec2f(dfao.grid.xy);
 let uv=(vec2f(texel)+vec2f(0.5))/grid;
 let plane=vec4f(surface.xyz,-dot(dfaoWorldAt(dfaoViewNdc(vec2f(texel)+vec2f(0.5)),surface.w),surface.xyz));
 let low=vec2f(dfao.cones.xy);
 let lowTexel=1.0/low;
 let jitterUv=dfao.jitter.xy/grid;
 let corner=floor((uv-jitterUv)*low);
 let cornerUv=corner*lowTexel;
 let share=(uv-cornerUv-jitterUv)*low;
 let at=vec2i(corner);
 let v00=dfaoConeBent(at);
 let v10=dfaoConeBent(at+vec2i(1,0));
 let v01=dfaoConeBent(at+vec2i(0,1));
 let v11=dfaoConeBent(at+vec2i(1,1));
 let corners=vec4f((1.0-share.y)*(1.0-share.x),(1.0-share.y)*share.x,share.y*(1.0-share.x),share.y*share.x);
 let lowCenter=cornerUv+0.5*lowTexel;
 let positions=vec4f(
  dfaoPositionWeight(plane,lowCenter*grid,v00.w),
  dfaoPositionWeight(plane,(lowCenter+vec2f(lowTexel.x,0.0))*grid,v10.w),
  dfaoPositionWeight(plane,(lowCenter+vec2f(0.0,lowTexel.y))*grid,v01.w),
  dfaoPositionWeight(plane,(lowCenter+lowTexel)*grid,v11.w));
 let fullCorner=cornerUv+jitterUv+0.5/grid;
 let normals=vec4f(
  dfaoNormalWeight(fullCorner,surface.xyz),
  dfaoNormalWeight(fullCorner+vec2f(lowTexel.x,0.0),surface.xyz),
  dfaoNormalWeight(fullCorner+vec2f(0.0,lowTexel.y),surface.xyz),
  dfaoNormalWeight(fullCorner+lowTexel,surface.xyz));
 let weights=corners*positions*normals;
 let inverse=1.0/max(dot(weights,vec4f(1.0)),0.00001);
 let bent=(weights.x*v00.xyz+weights.y*v10.xyz+weights.z*v01.xyz+weights.w*v11.xyz)*inverse;
 return vec4f(bent,surface.w);
}`,
)
