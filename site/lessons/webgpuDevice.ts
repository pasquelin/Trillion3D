const shader = `
struct View { camera: vec4f, light: vec4f }
@group(0) @binding(0) var<uniform> view: View;
struct In { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) color: vec3f }
struct Out { @builtin(position) position: vec4f, @location(0) color: vec3f }
fn rotate(p: vec3f) -> vec3f {
  let cy=cos(view.camera.x); let sy=sin(view.camera.x); let cp=cos(view.camera.y); let sp=sin(view.camera.y);
  let y=vec3f(cy*p.x+sy*p.z,p.y,-sy*p.x+cy*p.z);
  return vec3f(y.x,cp*y.y-sp*y.z,sp*y.y+cp*y.z);
}
@vertex fn vs(input: In) -> Out {
  let p=rotate(input.position); let z=p.z+view.camera.w; let f=2.05;
  var out: Out; out.position=vec4f(p.x*f/view.camera.z,p.y*f,z-0.1,z);
  let n=normalize(rotate(input.normal)); let lit=0.55+0.45*max(dot(n,normalize(view.light.xyz)),0.0);
  out.color=input.color*lit; return out;
}
@fragment fn fs(input: Out) -> @location(0) vec4f { return vec4f(input.color,1.0); }
`;
let gpuPromise;
export async function getIllustrationGpu() {
  if (!navigator.gpu) return null;
  gpuPromise ??= (async () => {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice(),
      format = navigator.gpu.getPreferredCanvasFormat(),
      module = device.createShaderModule({ code: shader });
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          {
            arrayStride: 36,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
    return { device, format, pipeline };
  })();
  return gpuPromise;
}
