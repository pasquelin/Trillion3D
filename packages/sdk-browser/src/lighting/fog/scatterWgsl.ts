import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FOG_LIGHTS_WGSL, fogLightsWgsl } from './lightsWgsl.ts'
import { FOG_PLAN_WGSL } from './planWgsl.ts'

/**
 * THE LIGHT EACH CELL OF THE VOLUME SCATTERS, one thread a cell: the sum of what the lights give
 * the cell's samples times what its medium scatters, plus the medium's own light, blended with the
 * volume of the image before.
 *
 * What a cell does — hidden behind the surfaces of its pixels, its history, its samples — is its plan
 * (`planWgsl.ts`). A cell takes the samples its plan names, each at the offset the image's jitter names
 * — the cell's centre without jitter —, moved forward off the depth buffer (`fogLiftOffSurface`), and
 * averages their light; the baked light (the static term, `staticWgsl.ts`) the pass before left for the
 * same samples adds to it, where the image has one. A hidden cell is not lit: it holds nothing, light or
 * extinction. The blend with the previous volume is the plan's weight of the history.
 *
 * The light is written multiplied by the image's pre-exposure (\`frame.exposure.x\`), the history's,
 * written multiplied by its own, brought to this one by the ratio (\`frame.exposure.y\`); the
 * extinction is left as it is. A surface reads the light divided by it again (\`readWgsl.ts\`). The result
 * is kept where it is positive and finite as a 32-bit float, and made zero where it is not
 * (\`fogPositiveFinite\`). The program lists the grid it reads the cells through (\`fogGridWgsl\`).
 */
export const fogScatterWgsl = (sampled: boolean) =>
  wgslBlock(
    sampled ? 'FOG_SCATTER_SAMPLED_WGSL' : 'FOG_SCATTER_WGSL',
    [FOG_PLAN_WGSL, sampled ? fogLightsWgsl(true) : FOG_LIGHTS_WGSL],
    `
/** The light of a cell over \`samples\` samples, one for each offset of the jitter. */
fn fogCellLight(cell:vec3u,samples:u32)->vec3f{
 var sum=vec3f(0.0);
 for(var s=0u;s<samples;s++){
  sum+=fogLightAt(cell,fogSampleOffset(cell,s));
 }
 return sum/f32(samples);
}
/** The baked light the static term's pass left for the cell, none where the image has no such pass. */
fn fogStaticTerm(cell:vec3u)->vec3f{
 if(frame.staticLight.w<=0.0){return vec3f(0.0);}
 return textureLoad(fogStaticIn,vec3i(cell)).rgb;
}
@compute @workgroup_size(4,4,4)
fn scatterMain(@builtin(global_invocation_id) cell:vec3u){
 if(any(cell>=vec3u(frame.grid.xyz))){return;}
 let plan=fogCellPlan(cell);
 if(plan.hidden){textureStore(fogScattering,vec3i(cell),vec4f(0.0));return;}
 let medium=fogMedium(cell);
 let scattered=((fogCellLight(cell,plan.samples)+fogStaticTerm(cell))*medium.scattering.xyz+medium.glow)*frame.exposure.x;
 var result=vec4f(scattered,medium.scattering.w);
 if(plan.alpha>0.0){
  let past=textureSampleLevel(fogPreviousVolume,fogSampler,min(plan.history,vec3f(frame.previous.zw,1.0)),0.0);
  result=mix(result,vec4f(past.rgb*frame.exposure.y,past.a),plan.alpha);
 }
 textureStore(fogScattering,vec3i(cell),fogPositiveFinite(result));
}`,
  )
