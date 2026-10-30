import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { WORLD_AT_WGSL, VIEW_WGSL } from '../../../deferred/worldAtWgsl.ts'
import { PAGE_INFO_STRUCT_WGSL } from '../../../../visibility/shader/pageWgsl.ts'
import { visPageIndex, visRowIn } from '../../../../visibility/visWords.ts'
import {
  SCREEN_PASS_VERTEX,
  drawScreenPass,
  screenPassGroup,
  screenPassPipeline,
} from '../../../../diagnostic/screenPass.ts'
import { chainReady } from '../../../deferred/fullscreen.ts'
import { ROOT_WORDS_WGSL } from '../../casters/rootWordsWgsl.ts'
import {
  MOBILITY_DEFORMS,
  MOBILITY_MOVING,
  MOBILITY_NO_CONTACT_SHADOW,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_OFTEN_MOVING,
  MOBILITY_SHADOWLESS,
} from '../../mobilityBits.ts'

const PASS = 'Trillion3D shadow caster colours'

/**
 * THE SHADOW CASTERS VIEW'S FALSE COLOUR (`virtual-shadow-map-shadow-casters`): each pixel takes the colour of the class of the placement it shows (`shadowCasterColor`, the colours of
 * `casterClass`), shaded by the angle between its face normal — the cross product of the derivatives of its position, rebuilt from the depth — and the view (`abs(dot) * 0.7 + 0.3`). A pixel
 * that shows no placement is black. The identifier of the placement of each pixel is read from the visibility identifiers through their page rows, the class from the placements' mobility words.
 */
const CODE = wgslProgram(
  `struct CasterView{display:vec2f,spare:vec2f,}
@group(0) @binding(0) var<uniform> casterView:CasterView;
@group(0) @binding(1) var ids:texture_2d<u32>;
@group(0) @binding(2) var<storage,read> pages:array<PageInfo>;
@group(0) @binding(3) var<storage,read> rootWords:array<u32>;
@group(0) @binding(4) var depth:texture_depth_2d;
@group(0) @binding(5) var<uniform> view:View;
${SCREEN_PASS_VERTEX}
fn shadowCasterColor(word:u32)->vec3f{
 if((word&${MOBILITY_SHADOWLESS}u)!=0u){return select(vec3f(1.0,1.0,0.0),vec3f(0.5),(word&${MOBILITY_NO_CONTACT_SHADOW}u)!=0u);}
 let deforms=(word&${MOBILITY_DEFORMS}u)!=0u;
 if((word&${MOBILITY_OFTEN_MOVING | MOBILITY_MOVING}u)==0u){return select(vec3f(0.0,1.0,0.0),vec3f(1.0,0.0,0.0),deforms);}
 if((word&${MOBILITY_MOVING}u)!=0u||deforms){return vec3f(0.5,0.0,0.5);}
 if((word&${MOBILITY_OFFSET_INVALIDATES}u)!=0u){return vec3f(0.0,0.0,1.0);}
 return vec3f(0.0,1.0,1.0);
}
@fragment fn fsCasterColor(@builtin(position) position:vec4f)->@location(0) vec4f{
 let size=textureDimensions(ids);
 let texel=min(vec2u(position.xy/casterView.display*vec2f(size)),size-vec2u(1u));
 let z=textureLoad(depth,texel,0);
 let world=worldAt(position.xy,z);
 // Derivatives need uniform flow: the face normal is taken before any pixel leaves.
 let normal=normalize(cross(dpdx(world),dpdy(world)));
 let shading=abs(dot(normal,viewToEye(world)))*0.7+0.3;
 let id=textureLoad(ids,texel,0).r;
 if(!visRowIn(id,arrayLength(&pages))){return vec4f(0.0,0.0,0.0,1.0);}
 let word=vsmRootWords(pages[visPageIndex(id)].placement).word;
 return vec4f(shadowCasterColor(word)*shading,1.0);
}`,
  [VIEW_WGSL, WORLD_AT_WGSL, PAGE_INFO_STRUCT_WGSL, visPageIndex, visRowIn, ROOT_WORDS_WGSL],
)

/** The WGSL text of the false colour, for the tests. */
export const CASTER_COLOR_WGSL = CODE

const pipelines = new WeakMap<GPUDevice, ReturnType<typeof screenPassPipeline>>()
const params = new WeakMap<GPUDevice, GPUBuffer>()

/**
 * Paints the false colour of the shadow casters view over the display image (before the boxes). Nothing is drawn while the pipeline compiles or a table it reads is missing.
 */
export function encodeShadowCasterColor(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const { gpu, vis, lights } = rt
  const roots = lights.rootWords
  if (
    !gpu.displayView ||
    !gpu.depthView ||
    !gpu.deferred ||
    !vis.visView ||
    !vis.pageTable ||
    !roots
  )
    return
  let pipeline = pipelines.get(device)
  if (!pipeline)
    pipelines.set(device, (pipeline = screenPassPipeline(device, PASS, CODE, 'fsCasterColor')))
  if (!chainReady(pipeline)) return
  let block = params.get(device)
  if (!block)
    params.set(
      device,
      (block = device.createBuffer({
        label: PASS,
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })),
    )
  device.queue.writeBuffer(block, 0, new Float32Array([...gpu.displaySize, 0, 0]))
  const made = pipeline.get()!
  drawScreenPass(encoder, PASS, made, gpu.displayView, [
    screenPassGroup(device, made, [
      { buffer: block },
      vis.visView,
      { buffer: vis.pageTable },
      { buffer: roots },
      gpu.depthView,
      { buffer: gpu.deferred.uniform },
    ]),
  ])
}
