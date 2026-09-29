/**
 * The shipped tile compaction (`packages/sdk-browser/src/lighting/tiles/compactWgsl.ts`) in one
 * workgroup of the tile pass's size, its statements and functions as the pass includes them. Only
 * the slice test is the probe's: light `i` sits at `x = i`, and `keeps[i]` names the slices it
 * reaches — bit 0 the opaque one, bit 1 the blend one —, so a case sets any mask it wants, and
 * the WGSL's lists, pool and overflow meet the oracle's (`light-tiles-spill-gpu.ts`, #849).
 */
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/index.ts';
import { directLightWgsl } from '../../../packages/sdk-browser/src/lighting/direct/lightWgsl.ts';
import {
  tileCompactResetWgsl,
  tileCompactStatementsWgsl,
  tileCompactWgsl,
} from '../../../packages/sdk-browser/src/lighting/tiles/compactWgsl.ts';

/** One run of the compaction: its mask width, whether it has a pool (the wide pass), the scene's
 *  light count, what each light reaches (`keeps`), and the pool's room and first free word. */
export type SpillCase = {
  name: string;
  words: number;
  pool: boolean;
  count: number;
  keeps: number[];
  capacity: number;
  head: number;
};

/** Bindings the harness declares beside the pass's own (1 view, 2 lights, 3 tiles, 4 pool). */
export const KEEPS_BINDING = 5;

export const spillHarness = (words: number, pool: boolean) => `
struct TileView{origin:vec4f,count:u32,}
@group(0) @binding(1) var<uniform> view:TileView;
@group(0) @binding(2) var<storage,read> lights:DirectLights;
@group(0) @binding(3) var<storage,read_write> tiles:array<u32>;
@group(0) @binding(${KEEPS_BINDING}) var<storage,read> keeps:array<u32>;
${directLightWgsl()}
/** The probe's slice test: what the light at \`centre.x\` names in \`keeps\`, never a bound. */
fn sliceHits(centre:vec3f,radius:f32,hasOpaque:bool,seesSky:bool)->vec2<bool>{
 let keep=keeps[u32(centre.x)];
 return vec2<bool>((keep&1u)!=0u,(keep&2u)!=0u);
}
${tileCompactWgsl(words, pool)}
@compute @workgroup_size(${LIGHT_SETTINGS.tileSize},${LIGHT_SETTINGS.tileSize},1)
fn main(@builtin(local_invocation_index) lane:u32){
 let base=0u;
 let hasOpaque=true;
 let seesSky=false;
${tileCompactResetWgsl(words, pool)}
 workgroupBarrier();
 let count=view.count;
${tileCompactStatementsWgsl(words, pool)}
}`;
