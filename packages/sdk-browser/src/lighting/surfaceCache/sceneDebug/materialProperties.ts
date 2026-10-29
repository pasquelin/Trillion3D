import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { autoKernel } from '../../../gpu/core/computeStages.ts'
import { createGpuPeriodicReadback } from '../../../gpu/core/periodicReadback.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../../materials/surface/physicalLobes.ts'
import { pixelModelOf } from '../../../materials/surface/pixelModel.ts'
import { SURFACE_MODEL_MASK } from '../../../materials/surface/surfaceModelWord.ts'
import { SURFACE_F0_WGSL, specularOfFlags } from '../../../materials/surface/surfaceSpecular.ts'
import { runLineKernel } from './gpuLines.ts'
import { LOBE_AXIS_WGSL } from '../../lobeAxisWgsl.ts'
import {
  MATERIAL_VECTORS,
  MATERIAL_WORDS,
  materialPropertiesLines,
} from './materialPropertiesText.ts'

/**
 * THE MATERIAL OF THE PIXEL UNDER THE CURSOR printed over the image (`material-properties`). One thread reads the pixel the cursor (`debugCursorX`, `debugCursorY`; the middle of the
 * image where none is set) falls on in the surfaces the lighting reads — the base colour and metalness, the normal and roughness, the emission and occlusion, the flags — and the physical
 * lobes' texel (anisotropy, clear coat, cloth), and writes what it found to a small buffer. The buffer is read back a few images late and written as text (`materialPropertiesLines`).
 */

const AT = { query: 0, base: 1, normal: 2, emission: 3, flags: 4, lobes: 5, found: 6 } as const
const FOUND_BYTES = MATERIAL_WORDS * 4

export const materialPropertiesWgsl = wgslProgram(
  `struct Query{cursor:vec4f}
@group(0) @binding(${AT.query}) var<uniform> query:Query;
@group(0) @binding(${AT.base}) var baseMetal:texture_2d<f32>;
@group(0) @binding(${AT.normal}) var normalRough:texture_2d<f32>;
@group(0) @binding(${AT.emission}) var emissiveAo:texture_2d<f32>;
@group(0) @binding(${AT.flags}) var surfaceFlags:texture_2d<u32>;
@group(0) @binding(${AT.lobes}) var surfaceLobes:texture_2d<u32>;
@group(0) @binding(${AT.found}) var<storage,read_write> found:array<vec4f,${MATERIAL_VECTORS}>;
// found: [0] base colour, metalness; [1] normal, roughness; [2] emission, occlusion; [3] surface model, pixel model, kind of lobes (0 none, 1 anisotropy and coat, 2 cloth), 1;
// [4] anisotropy, coat weight, coat roughness; [5] fuzz colour, cloth amount; [6] anisotropy direction; [7] coat normal; [8] the pixel; [9] specular colour at normal incidence, specular.
@compute @workgroup_size(1) fn debugMaterialProperties(){
 for(var k=0u;k<${MATERIAL_VECTORS}u;k++){found[k]=vec4f(0.0);}
 let size=textureDimensions(surfaceFlags);
 let pixel=min(vec2u(query.cursor.xy/query.cursor.zw*vec2f(size)),size-vec2u(1u));
 let at=vec2i(pixel);
 let flags=textureLoad(surfaceFlags,at,0).r;
 let base=textureLoad(baseMetal,at,0);
 let normal=textureLoad(normalRough,at,0);
 let emission=textureLoad(emissiveAo,min(at,vec2i(textureDimensions(emissiveAo))-vec2i(1)),0);
 surfaceSpecular=specularOfFlags(flags);
 var kind=0.0;
 if((flags&${PHYSICAL_SURFACE_FLAG}u)!=0u){
  let w=textureLoad(surfaceLobes,at,0);
  if(lobeIsCloth(w)){
   kind=2.0;
   found[5]=vec4f(packedFuzz(w),packedCloth(w));
  }else{
   kind=1.0;
   let coat=packedCoat(w);
   found[4]=vec4f(unpack2x16unorm(w.z).x,coat,0.0);
   found[6]=vec4f(lobeOctDecode(w.x),0.0);
   found[7]=vec4f(lobeOctDecode(w.y),0.0);
  }
 }
 found[0]=base;
 found[1]=vec4f(normalize(normal.xyz),normal.w);
 found[2]=emission;
 found[3]=vec4f(f32(flags&${SURFACE_MODEL_MASK}u),f32(pixelModelOf(flags)),kind,1.0);
 found[8]=vec4f(vec2f(pixel),0.0,0.0);
 found[9]=vec4f(surfaceF0(base.rgb,base.a),surfaceSpecular);
}`,
  [LOBE_AXIS_WGSL, SURFACE_F0_WGSL, specularOfFlags, pixelModelOf],
)

const kernel = autoKernel(
  'Trillion3D debug material properties',
  materialPropertiesWgsl,
  'debugMaterialProperties',
)

const NO_TEXT: readonly string[] = []

/** What the material properties view keeps between images: the cursor's uniform, the kernel's result and its readback, made at the first image the view is shown. */
export function createMaterialProperties(device: GPUDevice) {
  const query = device.createBuffer({
    label: 'Trillion3D debug material properties query',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const found = device.createBuffer({
    label: 'Trillion3D debug material properties result',
    size: FOUND_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const words = new Float32Array(MATERIAL_WORDS)
  const reader = createGpuPeriodicReadback(
    device,
    { label: 'Trillion3D debug material properties readback', bytes: FOUND_BYTES, eager: true },
    (mapped) => words.set(new Float32Array(mapped, 0, words.length)),
  )
  const cursor = new Float32Array(4)
  return {
    /** Reads the pixel under `cursorAt` (display pixels of a display of `size`; the middle where a coordinate is negative); whether the surfaces were there to read. */
    encode(
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      cursorAt: readonly [number, number],
      size: readonly [number, number],
    ) {
      const surfaces = rt.gpu.surfaces
      const stage = kernel(device)
      if (!surfaces || !stage.get()) return false
      const unset = cursorAt[0] < 0 || cursorAt[1] < 0
      cursor.set([
        unset ? size[0] / 2 : cursorAt[0],
        unset ? size[1] / 2 : cursorAt[1],
        size[0],
        size[1],
      ])
      device.queue.writeBuffer(query, 0, cursor)
      const views = surfaces.views()
      if (!surfaces.lobesView || views.slice(0, 4).some((view) => !view)) return false
      const bound: (GPUBindingResource | undefined)[] = []
      bound[AT.query] = { buffer: query }
      bound[AT.base] = views[0]
      bound[AT.normal] = views[1]
      bound[AT.emission] = views[2]
      bound[AT.flags] = views[3]
      bound[AT.lobes] = surfaces.lobesView
      bound[AT.found] = { buffer: found }
      runLineKernel(device, encoder, stage, bound, 1)
      if (reader.due(rt.run.frame) && reader.copy(encoder, found, 0, FOUND_BYTES))
        reader.sampled(rt.run.frame)
      return true
    },
    /** The text of the view, from the result as last read back (none before the first). */
    text: (): readonly string[] => (reader.ready ? materialPropertiesLines(words) : NO_TEXT),
    /** After the image's submit: the readback's copy maps. */
    submitted: () => reader.submitted(),
    dispose() {
      query.destroy()
      found.destroy()
      reader.dispose()
    },
  }
}

/** The material properties view's state (`createMaterialProperties`). */
export type MaterialProperties = ReturnType<typeof createMaterialProperties>
