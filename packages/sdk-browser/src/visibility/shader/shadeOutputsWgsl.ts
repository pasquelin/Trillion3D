import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import {
  REQUEST_OUTPUT,
  SURFACE_COLOURS_FORMAT,
  SURFACE_OUTPUTS,
  SURFACE_WORDS,
  SURFACE_WORDS_FORMAT,
} from '../../materials/surface/surfaceOutputs.ts'
import { shadeBinReadWgsl } from './shadeBinsWgsl.ts'
import { RECEIVER_WORDS_WGSL } from './receiverTargetWgsl.ts'

/**
 * What a material class's shading writes, its group 1 (`../passes/shadeLayout.ts`): the surfaces'
 * two layered targets — the colours and the words (`SurfaceBuffer`) —, the feedback target's
 * request, then the bins' head and elements it reads its pixels from (`shadeBinsWgsl.ts`). Three
 * storage textures, with the lobes target of group 0 four: what every device holds a stage.
 *
 * A surface of the table (`SURFACE_OUTPUTS`) is a member of the output struct (`SurfaceOut`) and a
 * layer of its target: a fixed one, or the image's for the emission-and-occlusion layer, which the
 * head names with the thin transmission's (`surfaceLayers`, 0 where the frame holds none) — so a
 * class never writes a layer the frame has not made. The emission layer and the request are written
 * under their overrides alone (`EMISSIVE_AO`, `FEEDBACK`). The thin transmission and the shadow
 * receiver have their own stores: the image's layer of the colours, the words' two receiver layers.
 */
export const SHADE_OUTPUT_BINDINGS = { colours: 0, words: 1, request: 2, bins: 3 } as const

type SurfaceOutput = (typeof SURFACE_OUTPUTS)[number]

/** The store of surface `output` of the surface `s` at pixel `at`. */
function store({ name, wgsl, target, layer }: SurfaceOutput) {
  const value = wgsl === 'u32' ? `vec4u(s.${name},0u,0u,0u)` : `s.${name}`
  if (layer !== undefined) return `textureStore(${target}Out,at,${layer}u,${value});`
  return `if(EMISSIVE_AO){let layer=surfaceLayers().x;if(layer!=0u){textureStore(${target}Out,at,layer,${value});}}`
}

const b = SHADE_OUTPUT_BINDINGS
export const SHADE_OUTPUTS_WGSL = wgslBlock(
  'SHADE_OUTPUTS_WGSL',
  [shadeBinReadWgsl(b.bins), RECEIVER_WORDS_WGSL],
  `@group(1) @binding(${b.colours}) var coloursOut:texture_storage_2d_array<${SURFACE_COLOURS_FORMAT},write>;
@group(1) @binding(${b.words}) var wordsOut:texture_storage_2d_array<${SURFACE_WORDS_FORMAT},write>;
@group(1) @binding(${b.request}) var requestOut:texture_storage_2d<${REQUEST_OUTPUT.format},write>;
/** What the resolve gives a pixel: its surfaces, then the tile rank it asks of virtual textures —
 *  the feedback target's, which transparents complete and a compute pass reduces into counters. */
struct SurfaceOut{${[...SURFACE_OUTPUTS, REQUEST_OUTPUT].map(({ name, wgsl }) => `${name}:${wgsl},`).join('')}}
/** The colours' layers of the emission and occlusion, then of the thin transmission, this image. */
fn surfaceLayers()->vec2u{let word=binsWord(SHADE_BIN_LAYERS,0u).x;return vec2u(word&255u,(word>>8u)&255u);}
/** The surface \`s\` of pixel \`at\` in its targets: a pixel is its class's alone, written once. */
fn storeSurface(at:vec2u,s:SurfaceOut){${SURFACE_OUTPUTS.map(store).join('')}if(FEEDBACK){textureStore(requestOut,at,vec4u(s.request,0u,0u,0u));}}
/** The thin transmission \`color\` of pixel \`at\`, in its layer while the frame holds one. */
fn storeSubsurface(at:vec2u,color:vec3f){let layer=surfaceLayers().y;if(layer!=0u){textureStore(coloursOut,at,layer,vec4f(color,1.0));}}
/** The shadow receiver of pixel \`at\` (\`receiverWords\`) in the words' two receiver layers. */
fn storeReceiver(at:vec2u,offset:vec3f,plane:vec3f){
 let words=receiverWords(offset,plane);
 textureStore(wordsOut,at,${SURFACE_WORDS.receiver}u,vec4u(words.x,0u,0u,0u));
 textureStore(wordsOut,at,${SURFACE_WORDS.receiver + 1}u,vec4u(words.y,0u,0u,0u));
}`,
)
