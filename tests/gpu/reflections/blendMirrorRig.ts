// What the transparent mirror proof draws with (`blendMirrorPage.ts`): its vertex, the blend
// pass's group and the screen reflection's.
import { createScreenReflection } from '../../../packages/sdk-browser/src/reflections/gpu.ts'
import { MODEL_SHIFT } from '../../../packages/sdk-browser/src/scene/surfaceModel.ts'
import { blendBindEntries } from '../../../packages/sdk-browser/src/webgpu/core/bindEntries.ts'
import { BLEND_BINDINGS } from '../../../packages/sdk-browser/src/webgpu/core/bindLayout.ts'
import { BLEND_VIEW_SIZE } from '../../../packages/sdk-browser/src/webgpu/blend/uniforms.ts'
import type { WebgpuTileStreamer } from '../../../packages/sdk-browser/src/webgpu/tile/streamer.ts'
import { PAGE_HEADER_WORDS } from '../../../packages/sdk-browser/src/webgpu/tile/pageTable.ts'
import { createDeferredPlaceholders } from '../../../packages/sdk-browser/src/lighting/deferred/setup.ts'
import {
  createSceneLightContractBuffer,
  uploadSceneLights,
} from '../../../packages/sdk-browser/src/webgpu/pages/state/lightBuffer.ts'
import { createWebgpuLightState } from '../../../packages/sdk-browser/src/webgpu/pages/state/lights.ts'
import { PROXY_HEADER_BYTES } from '../../../packages/sdk-browser/src/bounce/sizes.ts'
import { BOUNCE_GRID_BYTES } from '../../../packages/sdk-browser/src/bounce/uniform.ts'
import { createGpuBounceProxy } from '../../../packages/sdk-browser/src/bounce/proxy.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { mirrorProxy } from './mirrorProxy.ts'

/** The proof's vertex for the blend fragment (`VSOut`, `webgpu/blend/vertexWgsl.ts`): a square
 *  facing the view, an untextured metal plane, or a diffuse/toon plane with roughness 1 and a
 *  zero-green map; no subsurface (`normal.w`). Flat model bits are the ones the production vertex
 *  takes from the item's spare lane. */
export const mirrorVertex = (rough: number, model: number) => `
@vertex fn mirrorVertex(@builtin(vertex_index) i:u32)->VSOut{
 var out:VSOut;
 let p=vec2f(f32(i32(i&1u)*4-1),f32(i32(i>>1u)*4-1));
 out.position=vec4f(p,0.5,1.0);out.view=vec3f(p,0.0);
 out.normal=vec4f(0.0,0.0,1.0,0.0);out.color=vec4f(1.0);
 out.ids=vec3u(0u,${17 | (model << MODEL_SHIFT)}u,0u);
 out.pbr=vec4f(${model ? 1 : rough},${model ? 0 : 1},1.0,1.0);
 out.maps.x=${model ? 1 : 0}u;
 return out;
}`

/** The screen reflection's group with its source off: the mirror reads the proxy alone, never a
 *  screen hit. */
export function proxyOnlyReflection(device: GPUDevice) {
  const depth = device.createTexture({
    size: [1, 1],
    format: 'depth32float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const reflection = createScreenReflection(device, 1, 1, depth.createView(), false)
  return {
    group: reflection.group,
    dispose() {
      reflection.dispose()
      depth.destroy()
    },
  }
}

/**
 * The blend pass's group: the engine's own entry list (`blendBindEntries`) on the stand-ins a frame
 * without shadows or probes binds (`createDeferredPlaceholders`), an empty light store's buffer,
 * and the proof's proxy, surface cache and bounce switch.
 */
export function mirrorGroup(device: GPUDevice, layout: GPUBindGroupLayout) {
  const buffer = (size: number, data?: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => {
    const created = device.createBuffer({
      size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    if (data) device.queue.writeBuffer(created, 0, data)
    return created
  }
  const placeholders = createDeferredPlaceholders(device)
  const zero = buffer(256 * 1024)
  const store = createSceneLightStore()
  const lights = createWebgpuLightState(store)
  lights.buffer = createSceneLightContractBuffer(device, store)
  uploadSceneLights(device, lights)
  // The view point straight ahead; nothing else of the view is read past the proof's vertex.
  const view = new Float32Array(BLEND_VIEW_SIZE / 4)
  view.set([0, 0, 1, 0], 16)
  // `BounceGrid`: the reach, and the probe count — zero turns bounce, hence the proxy, off.
  const grid = new Uint32Array(BOUNCE_GRID_BYTES / 4)
  new Float32Array(grid.buffer)[0] = 10
  grid[7] = 1
  const gridBuffer = buffer(BOUNCE_GRID_BYTES, grid)
  // The surface cache's atlas: the proxy triangle's two faces, one texel each.
  const cache = device.createTexture({
    size: [2, 1],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  })
  const faces = (rgba: number[]) =>
    device.queue.writeTexture(
      { texture: cache },
      new Float32Array([...rgba, ...rgba]),
      { bytesPerRow: 32 },
      [2, 1],
    )
  faces([0.8, 0.2, 0.05, 1])
  const proxy = createGpuBounceProxy(device, mirrorProxy())
  // The maps: one white colour texel, one data texel whose green — the roughness — is zero.
  const lane = (green: number) => {
    const texel = device.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    const rgba = new Uint8Array([255, green, 255, 255])
    device.queue.writeTexture({ texture: texel }, rgba, { bytesPerRow: 4 }, [1, 1])
    return texel.createView({ dimension: '2d-array' })
  }
  const pages = new Uint32Array(256)
  pages[PAGE_HEADER_WORDS] = 0x00010001
  const atlas = (view: GPUTextureView) => ({
    views: BLEND_BINDINGS.color.lanes.map(() => view),
    pages: { buffer: buffer(1024, pages) },
  })
  const group = device.createBindGroup({
    layout,
    entries: blendBindEntries({
      textures: { color: atlas(lane(255)), data: atlas(lane(0)) } as unknown as WebgpuTileStreamer,
      sampler: device.createSampler(),
      indices: zero,
      positions: zero,
      uvs: zero,
      uniform: buffer(BLEND_VIEW_SIZE, view),
      uniformSize: BLEND_VIEW_SIZE,
      items: zero,
      normals: placeholders.emptyNormals,
      clusterDiagnostic: zero,
      planInstances: zero,
      clusterSpans: zero,
      directLights: lights.buffer,
      shadowData: placeholders.vsmPageTable,
      shadowAtlas: placeholders.vsmProjectionData,
      shadowSampler: placeholders.vsmUniforms,
      shadowTransmittance: placeholders.transmittanceView,
      shadowTranslucentDepth: placeholders.vsmPool,
      bounceGrid: gridBuffer,
      probes: placeholders.probes,
      tileLights: placeholders.tiles,
      proxy: proxy.buffer,
      surfaceCache: cache.createView(),
    }),
  })
  return {
    group,
    faces,
    /** Moves the proxy triangle to `vertices`, three world points. */
    moveProxy(vertices: number[]) {
      device.queue.writeBuffer(proxy.buffer, PROXY_HEADER_BYTES, new Float32Array(vertices))
    },
    /** Bounce off: a probe count of zero, so no proxy is read. */
    bounceOff() {
      grid[7] = 0
      device.queue.writeBuffer(gridBuffer, 0, grid)
    },
    dispose() {
      placeholders.dispose()
      lights.buffer?.destroy()
    },
  }
}
