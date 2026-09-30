// Diagnostic only: shader execution and compilation, no image or timing proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dansPageWebgpu } from './pageWebgpu.ts';
import { SHADOW_DEPTH_SHADER } from '../../../packages/sdk-browser/src/gpu/shadow/shader.ts';
import { BLEND_TRANSMITTANCE_WGSL } from '../../../packages/sdk-browser/src/gpu/shadow/transmittanceWgsl.ts';
import { PAGE_INFO_STRUCT_WGSL } from '../../../packages/sdk-browser/src/visibility/shader/pageWgsl.ts';

const compute = `${PAGE_INFO_STRUCT_WGSL}
fn maskAlpha(a:u32,b:vec2f,c:vec2f,d:vec2f,e:bool)->f32{return 0.5;}
fn colorSample(a:u32,b:vec2f,c:vec2f,d:vec2f,e:bool)->vec4f{return vec4f(0.25,0.5,1.0,0.5);}
${BLEND_TRANSMITTANCE_WGSL}
@group(0) @binding(0) var<storage,read_write> result:array<vec4f>;
@compute @workgroup_size(1) fn main(@builtin(global_invocation_id) id:vec3u){
 var p:PageInfo;p.world=mat4x4f(vec4f(1,0,0,0),vec4f(0,1,0,0),vec4f(0,0,1,0),vec4f(0,0,0,1));
 p.transmission=1.0;p.thickness=2.0;p.blendCoverage=1.0;p.baseColor=vec4f(1.0);
 p.attenuationRG=vec2f(0.5,0.25);p.attenuationB=1.0;p.attenuationDistance=2.0;
 if(id.x==1u){p.flags=12u;}
 if(id.x<2u){result[id.x]=blendTransmittance(p,vec2f(0),vec2f(1,0),vec2f(0,1),vec3f(0,0,1));}
 else{result[id.x]=vec4f(select(0.0,1.0,volumeBoundary(p,true)),select(0.0,1.0,volumeBoundary(p,false)),volumeWorldThickness(p,vec3f(0,0,1)),1.0);}
}`;

if (import.meta.main)
  test('colored volume arithmetic and complete shadow pipeline compile and execute', async () => {
    const answer = await dansPageWebgpu(
      async (input: { compute: string; render: string }) => {
        const opened = await globalThis.openGpuDevice();
        if (!opened) throw new Error('WebGPU unavailable');
        const { device, errors } = opened;
        const render = await opened.compile(input.render);
        errors.push(...render.compilation);
        await device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module: render.module, entryPoint: 'shadow_blend_vs' },
          fragment: {
            module: render.module,
            entryPoint: 'shadow_blend_fs',
            targets: [{ format: 'rgba8unorm' }],
          },
          primitive: { topology: 'triangle-list', cullMode: 'none' },
          depthStencil: {
            format: 'depth32float',
            depthWriteEnabled: true,
            depthCompare: 'greater',
          },
        });
        const module = await opened.compile(input.compute);
        errors.push(...module.compilation);
        const pipeline = await device.createComputePipelineAsync({
          layout: 'auto',
          compute: { module: module.module, entryPoint: 'main' },
        });
        const values = await globalThis.computeReadback(device, pipeline, 48, 3);
        device.destroy();
        return { values, errors };
      },
      { compute, render: SHADOW_DEPTH_SHADER },
    );
    assert.deepEqual(answer.errors, []);
    assert.deepEqual(answer.values, [0.5, 0.25, 1, 0, 0.5625, 0.5625, 1, 0.5, 1, 0, 2, 1]);
  });
