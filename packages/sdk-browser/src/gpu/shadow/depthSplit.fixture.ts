// OMB-01: float32 reversed-depth raster of shipped WGSL against develop's single draw before #965.
import { DEPTH_CLEAR, depthNearer } from '../../camera/depthConvention.ts';
import { FLAG_BLEND_CASTER } from '../../visibility/types.ts';
import { shaderFunctions } from '../../texture/shaderRule.fixture.ts';
import { KEPT_LISTS_WGSL } from './cullShader.ts';
import { SHADOW_DEPTH_SHADER } from './shader.ts';
const roundEven = (x: number) => (Math.abs(x % 1) === 0.5 ? 2 * Math.round(x / 2) : Math.round(x));

/** Frozen pre-#965 vertex (parent of 9935e9392); both paths share the #1016 sun snap. */
const DEVELOP_VERTEX = `fn developVertex(vertexIndex:u32,instanceIndex:u32,blended:bool)->ShadowOut{
 var out:ShadowOut;
 let pageIndex=drawPage(instanceIndex);
 let page=pages[pageIndex];
 out.instance=pageIndex;out.uv=vec2f(0.0);out.fromEmitter=vec3f(0.0);
 let kind=(page.flags&${FLAG_BLEND_CASTER}u)!=0u;
 if(vertexIndex>=page.indexCount||kind!=blended){out.position=vec4f(0.0,0.0,2.0,1.0);return out;}
 let h=pageHeader(page);
 let id=pageCorner(page,h,vertexIndex);
 let vertex=pagePosition(page,h,id);
 out.position=sunSnap(shadow,shadow.viewProjection*page.world*vec4f(vertex,1.0));
 out.fromEmitter=(page.world*vec4f(vertex,1.0)).xyz-shadow.emitter.xyz;
 if((page.flags&4u)!=0u){out.uv=pageUv(page,h,id);}
 return out;
}`;

type Vec = Record<string, number>;
export type Mat = Vec[];
export type ShadowOut = { position: Vec; instance: number; uv: Vec; fromEmitter: Vec };
type Entry = (vertexIndex: number, instanceIndex: number) => ShadowOut;

const f = Math.fround,
  AXES = ['x', 'y', 'z', 'w'];
const vector =
  (size: number) =>
  (...parts: Array<number | Vec>): Vec => {
    const words = parts.flatMap((part) =>
      typeof part === 'number' ? [part] : Object.values(part),
    );
    const all = words.length === 1 ? new Array<number>(size).fill(words[0]) : words;
    return Object.fromEntries(all.map((word, i) => [AXES[i], f(word)]));
  };
const vec2f = vector(2),
  vec3f = vector(3);
export const vec4f = vector(4);
const times = (m: Mat, v: Vec) =>
  Object.fromEntries(
    AXES.map((axis) => [
      axis,
      Object.values(v).reduce((sum, word, column) => f(sum + f(m[column][axis] * word)), 0),
    ]),
  );
const mul = (a: Mat, b: Mat | Vec) =>
  Array.isArray(b) ? b.map((column) => times(a, column)) : times(a, b);
const sub3 = (a: Vec, b: Vec) => vec3f(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: Vec, b: Vec) =>
  Object.keys(a).reduce((sum, axis) => f(sum + f(a[axis] * b[axis])), 0);

/** A page-table row, as far as the depth draws read it. */
type ShadowPage = {
  flags: number;
  indexCount: number;
  pageOffset: number;
  vertexBase: number;
  world: Mat;
  dash: Vec;
  baseColor: Vec;
};

/** What the shader reads: the page table, the geometry, the lists and the face. */
export type ShadowScene = {
  pages: ShadowPage[];
  indices: number[];
  positions: number[];
  uvs: number[];
  instances: number[];
  slotOffsets: number[];
  uni: { indirect: number; drawSlot: number };
  shadow: { viewProjection: Mat; params: Vec; emitter: Vec };
};

type ShadowEntries = Record<'shadow_vs' | 'shadow_cutout_vs', Entry> & {
  shadow_depth_vs: (vertexIndex: number, instanceIndex: number) => Vec;
  developVertex: (vertexIndex: number, instanceIndex: number, blended: boolean) => ShadowOut;
  shadowKeep: (frag: ShadowOut, gx: Vec, gy: Vec) => boolean;
  keptAt: (region: number, rank: number, capacity: number, cutout: boolean) => number;
};

/** The shipped depth entries, `shadowVertex`, `shadowKeep` and the page geometry they call, with
 *  develop's corner beside them, over `scene`: only the matrix products and the `in` parameter
 *  are respelled for JavaScript. */
export function shadowEntries(scene: ShadowScene): ShadowEntries {
  let source = `${SHADOW_DEPTH_SHADER}\n${DEVELOP_VERTEX}\n${KEPT_LISTS_WGSL}`
    .replace(/@\w+(?:\([^)]*\))? ?/g, '')
    .replace(/var (\w+):\w+;/g, 'let $1={};')
    .replace(/\bin\b(?=[.:)])/g, 'frag');
  // The products are respelled by their shape in `shadowVertex` (and its frozen copy): a reshaped
  // expression must fail here, not as NaN depths further down.
  const products: Array<[RegExp, string]> = [
    [/([\w.]+)\*([\w.]+)\*(vec4f\([^()]*\))/g, 'mul(mul($1,$2),$3)'],
    [/\(([\w.]+)\*(vec4f\([^()]*\))\)\.xyz-([\w.]+)\.xyz/g, 'sub3(mul($1,$2),$3)'],
  ];
  for (const [shape, spelled] of products) {
    const found = source.match(shape)?.length ?? 0;
    if (found !== 2) throw new Error(`${shape}: ${found} matches, 2 expected`);
    source = source.replace(shape, spelled);
  }
  const names = [
    ...['drawPage', 'cutoutPage', 'shadowVertex', 'shadowVertexIn', 'developVertex', 'shadow_vs'],
    ...[
      'shadow_depth_vs',
      'onEmitter',
      'shadowKeepAt',
      'shadow_cutout_vs',
      'shadowKeep',
      'maskKeep',
    ],
    ...['lineDash', 'pageHeader', 'pageCorner', 'pageRestPosition', 'pagePosition', 'pageUv'],
    ...['vertPos', 'vertUv', 'keptAt', 'snapGrid', 'sunSnap'],
  ];
  const scope = {
    ...scene,
    ...{ vec2f, vec3f, vec4f, mul, sub3, dot, abs: Math.abs, floor: Math.floor, round: roundEven },
  };
  return shaderFunctions<ShadowEntries>(source, names, scope);
}

/** One indirect draw: `instances` casters through `entry`, with `shadow_fs`'s test or none. */
type DepthDraw = { entry: Entry; instances: number; fragment: boolean };

/**
 * The page's depth after `draws`, in order, as its 32-bit words: cleared to 0 (far), a texel
 * written where a fragment passes `keep` — when its draw has a fragment stage — and lies nearer the
 * light than the texel (`greater`). Coverage is the audit's edge test at texel centres; depth and
 * varyings are interpolated in window space; a corner behind the eye or a depth outside [0, 1]
 * draws nothing there.
 */
export function rasterDepth(
  side: number,
  vertexCount: number,
  draws: DepthDraw[],
  keep: (frag: ShadowOut) => boolean,
) {
  const depth = new Float32Array(side * side).fill(DEPTH_CLEAR);
  for (const { entry, instances, fragment } of draws)
    for (let instance = 0; instance < instances; instance++)
      for (let corner = 0; corner + 2 < vertexCount; corner += 3) {
        const outs = [0, 1, 2].map((k) => entry(corner + k, instance));
        if (!outs.every(({ position: p }) => p.w > 0)) continue;
        const [a, b, c] = outs.map(({ position: p }) => ({
          x: f((f(p.x / p.w) * 0.5 + 0.5) * side),
          y: f((0.5 - f(p.y / p.w) * 0.5) * side),
          z: f(p.z / p.w),
        }));
        // The triangle's box of texels; a corner that is not finite scans the whole page.
        const span = (axis: 'x' | 'y') => {
          const ends = [a[axis], b[axis], c[axis]];
          if (!ends.every(Number.isFinite)) return [0, side - 1];
          return [
            Math.max(0, Math.floor(Math.min(...ends) - 0.5)),
            Math.min(side - 1, Math.ceil(Math.max(...ends) - 0.5)),
          ];
        };
        const [x0, x1] = span('x'),
          [y0, y1] = span('y');
        for (let ty = y0; ty <= y1; ty++)
          for (let tx = x0; tx <= x1; tx++) {
            const texel = ty * side + tx,
              px = tx + 0.5,
              py = ty + 0.5;
            const e0 = (b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x),
              e1 = (c.x - b.x) * (py - b.y) - (c.y - b.y) * (px - b.x),
              e2 = (a.x - c.x) * (py - c.y) - (a.y - c.y) * (px - c.x),
              area = e0 + e1 + e2;
            const inside = (e0 >= 0 && e1 >= 0 && e2 >= 0) || (e0 <= 0 && e1 <= 0 && e2 <= 0);
            if (!inside || !area) continue;
            const blend = (u: number, v: number, w: number) => f((e1 * u + e2 * v + e0 * w) / area);
            const z = blend(a.z, b.z, c.z);
            if (!(z >= 0 && z <= 1) || !depthNearer(z, depth[texel])) continue;
            if (fragment) {
              const varying = (pick: (out: ShadowOut) => Vec) =>
                Object.fromEntries(
                  Object.keys(pick(outs[0])).map((axis) => [
                    axis,
                    blend(pick(outs[0])[axis], pick(outs[1])[axis], pick(outs[2])[axis]),
                  ]),
                );
              const frag = {
                position: vec4f(px, py, z, 1),
                instance: outs[0].instance,
                uv: varying((out) => out.uv),
                fromEmitter: varying((out) => out.fromEmitter),
              };
              if (!keep(frag)) continue;
            }
            depth[texel] = z;
          }
      }
  return new Uint32Array(depth.buffer);
}
