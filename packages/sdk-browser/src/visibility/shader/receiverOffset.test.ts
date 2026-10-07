// The shadow receiver offset is not stored by the resolve beside the G-buffer; its
// readers recompute it from the visibility buffer. This runs the shipped `shadowReceiver` against
// the statements a resolve would store it with (kept below but the
// line widening, whose result it never stored), on the same pages, pixels and shared routines: the
// same operations in the same order give the same bits, here in double precision.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Mat, shaderRun } from '../../texture/shaderRun.fixture.ts'
import { builtins } from '../../texture/shaderRunBuiltins.fixture.ts'
import { perspectiveProjection } from '../../../../sdk-core/src/index.ts'
import { CLASS_FEATURE } from './classWords.ts'
import { receiverOffsetWgsl } from './receiverOffsetWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

/** The statements that would write the offset in the resolve, in their order; a discarded or
 *  empty pixel stored nothing, which the readers never read. */
const STORED_WGSL = `fn storedOffset(pos:vec2f)->vec3f{
 let id=textureLoad(vis,vec2i(i32(pos.x),i32(pos.y)),0).r;
 if(id==0u){return vec3f(0.0);}
 let pageIndex=(id>>8u)-1u;
 if(pageIndex>=uni.pageCount){return vec3f(0.0);}
 var stored=vec3f(0.0);
 let tri=id&0xffu;
 let page=pages[pageIndex];
 let HAS_VERTEX_NORMAL=(page.materialClass&${CLASS_FEATURE.HAS_VERTEX_NORMAL}u)!=0u;
 let DOUBLE_SIDED=(page.materialClass&${CLASS_FEATURE.DOUBLE_SIDED}u)!=0u;
 if(tri*3u+2u>=page.indexCount){return vec3f(0.0);}
 let h=pageHeader(page);
 let corners=pageTriangle(page,h,tri);let i0=corners.x;let i1=corners.y;let i2=corners.z;
 let p0=pagePosition(page,h,i0);let p1=pagePosition(page,h,i1);let p2=pagePosition(page,h,i2);
 var w0=page.world*vec4f(p0,1.0);var w1=page.world*vec4f(p1,1.0);var w2=page.world*vec4f(p2,1.0);
 if(page.sprite.y!=0.0){w0=pageSprite(page,p0);w1=pageSprite(page,p1);w2=pageSprite(page,p2);}
 var c0=uni.viewProj*w0;var c1=uni.viewProj*w1;var c2=uni.viewProj*w2;
 if(page.lineWidth>0.0){c0=pageLine(c0);c1=pageLine(c1);c2=pageLine(c2);}
 let s0=framebuffer(c0);let s1=framebuffer(c1);let s2=framebuffer(c2);
 let p=vec2f(pos.x,pos.y);
 let area=edgeFunction(s1.xy,s2.xy,s0.xy);
 var bary=vec3f(0.333,0.333,0.334);
 if(area!=0.0){
  let bw=affineBarycentric(s0.xy,s1.xy,s2.xy,p,area);let a0=bw.x;let a1=bw.y;let a2=bw.z;
  let iw0=1.0/c0.w;let iw1=1.0/c1.w;let iw2=1.0/c2.w;
  let p0w=a0*iw0;let p1w=a1*iw1;let p2w=a2*iw2;let sum=p0w+p1w+p2w;
  bary=select(vec3f(a0,a1,a2),vec3f(p0w,p1w,p2w)/sum,sum!=0.0);
 }
 let screenFace=select(-1.0,1.0,area*c0.w*c1.w*c2.w<0.0);
 let world3=mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz);
 let face=screenFace*select(-1.0,1.0,determinant(world3)>=0.0);
 let side=select(1.0,-1.0,(page.flags&256u)!=0u);
 let invT=invTranspose3Prep(world3);
 var n0=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i0)))*side;
 var n1=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i1)))*side;
 var n2=uniteOuZero(invTranspose3Apply(invT,pageNormal(page,h,i2)))*side;
 if(HAS_VERTEX_NORMAL){
  let P=(w0*bary.x+w1*bary.y+w2*bary.z).xyz;
  let lit=select(1.0,face,DOUBLE_SIDED);
  let offset=shadingPointOffset(P,bary,w0.xyz,w1.xyz,w2.xyz,n0*lit,n1*lit,n2*lit);
  if(page.sprite.y==0.0&&page.lineWidth==0.0){stored=offset;}
 }
 return stored;
}`

type V = number[]
const cross = builtins.cross as (a: V, b: V) => V,
  dot = builtins.dot as (a: V, b: V) => number
const det3 = (m: V[]) => dot(m[0], cross(m[1], m[2]))
/** A page's world, a matrix the WGSL both multiplies and reads by column: `Mat` holds both. */
const world = (m: V) => new Mat(m)

// A curved patch — a sphere's cap facing the camera, its normals radial: the penumbra fixture.
const positions: V[] = [],
  normals: V[] = []
const GRID = 3
for (let i = 0; i < GRID; i++)
  for (let j = 0; j < GRID; j++) {
    const theta = (i / (GRID - 1) - 0.5) * 1.1,
      phi = (j / (GRID - 1) - 0.5) * 0.8
    const n = [Math.sin(theta) * Math.cos(phi), Math.sin(phi), Math.cos(theta) * Math.cos(phi)]
    normals.push(n)
    positions.push([n[0] * 2, n[1] * 2, n[2] * 2 - 6])
  }
const corners: number[] = []
for (let i = 0; i + 1 < GRID; i++)
  for (let j = 0; j + 1 < GRID; j++) {
    const a = i * GRID + j
    corners.push(a, a + GRID, a + 1, a + 1, a + GRID, a + GRID + 1)
  }
const TRIANGLES = corners.length / 3,
  NORMAL = CLASS_FEATURE.HAS_VERTEX_NORMAL,
  TWO_SIDED = NORMAL | CLASS_FEATURE.DOUBLE_SIDED
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const row = (over: object = {}) => ({
  world: world(IDENTITY),
  indexCount: corners.length,
  materialClass: NORMAL,
  sprite: [0, 0],
  lineWidth: 0,
  flags: 0,
  ...over,
})
const pages = [
  row(),
  // Sheared and scaled: the normals go through the inverse transpose.
  row({ world: world([1.5, 0, 0.2, 0, 0, 0.8, 0, 0, 0, 0.3, 1.2, 0, 0.2, -0.1, 0.5, 1]) }),
  // Mirrored, two-sided: the face it is seen from turns the normals.
  row({
    world: world([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0, 0, 1]),
    materialClass: TWO_SIDED,
  }),
  row({ materialClass: TWO_SIDED, flags: 256 }),
  row({ sprite: [0, 1] }),
  row({ lineWidth: 2 }),
  row({ materialClass: 0 }),
  row({ indexCount: 3 }),
]
const viewport = [64, 48]
const projection = perspectiveProjection(new Float64Array(16), 50, 64 / 48, 0.1, 1)
let id = 0
type Page = (typeof pages)[number]
const scope = {
  vis: {},
  uni: { viewProj: new Mat([...projection]), viewport, pageCount: pages.length },
  pages,
  textureLoad: () => [id, 0, 0, 0],
  pageHeader: () => 0,
  pageTriangle: (_: Page, __: number, tri: number) => corners.slice(tri * 3, tri * 3 + 3),
  pagePosition: (_: Page, __: number, vertex: number) => positions[vertex],
  pageNormal: (_: Page, __: number, vertex: number) => normals[vertex],
  pageSprite: (_: Page, p: V) => [...p, 1],
  pageLine: (clip: V) => clip,
  mat3x3f: (...columns: V[]) => columns,
  determinant: det3,
  invTranspose3Prep: (m: V[]) => ({
    adj: [cross(m[1], m[2]), cross(m[2], m[0]), cross(m[0], m[1])],
    scale: 1 / det3(m),
  }),
  invTranspose3Apply: (t: { adj: V[]; scale: number }, v: V) =>
    [0, 1, 2].map((r) => t.scale * (t.adj[0][r] * v[0] + t.adj[1][r] * v[1] + t.adj[2][r] * v[2])),
}
// The shipped text the readers insert, which carries the shared routines both sides call.
const SHIPPED = wgslModule(receiverOffsetWgsl(0))
const HELPERS = [
  'framebuffer',
  'clipToFramebuffer',
  'perspectiveDivide',
  'edgeFunction',
  'affineBarycentric',
  'pixelBary',
  'perspectiveBarycentric',
  'faceNormal',
  'vertexNormals',
  'transformedNormals',
  'uniteOuZero',
  'shadingPointOffset',
  'worldMatrix3',
  'windingKept',
]
const { shadowReceiver } = shaderRun<{ shadowReceiver: (pixel: V) => { offset: V } }>(
  SHIPPED,
  ['shadowReceiver', ...HELPERS],
  { ...scope, ShadowReceiver: (offset: V, plane: V) => ({ offset, plane }) },
)
const { storedOffset } = shaderRun<{ storedOffset: (pixel: V) => V }>(
  `${STORED_WGSL}\n${SHIPPED}`,
  ['storedOffset', ...HELPERS],
  scope,
)

test('the recomputed receiver offset is the stored one, bit for bit, on every page and pixel', () => {
  let curved = 0,
    checked = 0
  // Every row, and one past the table; the background too.
  const ids = [0]
  for (let page = 0; page <= pages.length; page++)
    for (let tri = 0; tri < TRIANGLES; tri++) ids.push(((page + 1) << 8) | tri)
  for (const pixelId of ids)
    for (let y = 4; y < viewport[1]; y += 8)
      for (let x = 4; x < viewport[0]; x += 8) {
        id = pixelId
        const pixel = [x + 0.5, y + 0.5]
        const expected = storedOffset(pixel)
        assert.deepEqual(shadowReceiver(pixel).offset, expected, `id ${pixelId} at ${pixel}`)
        if (expected.some((v) => v !== 0)) curved++
        checked++
      }
  assert.ok(curved > 0, `a curved patch raises its receivers: ${curved} of ${checked}`)
})
