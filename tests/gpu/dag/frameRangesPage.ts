// The engine's real cut (`createDagResources`, `encodeDagKernels`) on the device the engine opens
// (`requestExplorerDevice`), once whole and once through that same device reporting a binding half
// the primitives' `frames`: `frames` then splits in two ranges (`frameRanges.ts`) and every table
// past the binding in parts bound at once (`split.ts`). Only the capacity the cut reads
// changes; the device underneath is the same.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { createDagResources } from '../../../packages/sdk-browser/src/gpu/dag/resources.ts';
import { encodeDagKernels } from '../../../packages/sdk-browser/src/gpu/dag/encode.ts';
import {
  writeDagUniforms,
  parseDagOutput,
} from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts';
import { framesBytes } from '../../../packages/sdk-browser/src/gpu/dag/frameRanges.ts';
import { dagDeviceRefusal } from '../../../packages/sdk-browser/src/gpu/dag/deviceRefusal.ts';
import { selectionListCap } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import { openGpuDevice } from '../kit/webgpuDevice.ts';
import { sceneView } from './cutScene.ts';

/** Placements of a small pyramid, ten abreast, row behind row: the first range's behind the
 *  camera, the second's before it, its outer columns past the frustum's sides. Small, so its tables
 *  split in few parts where `frames` splits in two: a deeper hierarchy's would need more storage
 *  bindings than a stage holds (ten on Apple's Metal), and the engine refuses that device
 *  (`deviceRefusal.ts`). */
const PLACEMENTS = 600;
const poses = Array.from({ length: PLACEMENTS }, (_, k) =>
  new G.Matrix4().makeTranslation(
    ((k % 10) - 4.5) * 4,
    0,
    k < PLACEMENTS / 2 ? 60 : -Math.floor((k - PLACEMENTS / 2) / 10) * 6,
  ),
);

/** `device` reporting `binding` bytes per buffer and per storage binding, every other limit and
 *  every call its own. */
function reporting(device: GPUDevice, binding: number) {
  const capped = new Set<PropertyKey>(['maxBufferSize', 'maxStorageBufferBindingSize']);
  const limits = new Proxy(device.limits, {
    get: (target, key) => (capped.has(key) ? binding : Reflect.get(target, key, target)),
  });
  return new Proxy(device, {
    get: (target, key) => {
      if (key === 'limits') return limits;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/** The cut at each threshold of `pixelErrors`, whole and split, and what the engine's device check
 *  says of the split device. */
export async function cutWholeAndSplit(pixelErrors: number[]) {
  const gpu = await openGpuDevice();
  if (!gpu) throw new Error('WebGPU must be available');
  const { device, errors } = gpu;
  const { packed, uniforms } = sceneView(8, 2, poses);
  const lying = reporting(device, framesBytes(Math.ceil(packed.worldCount / 2)));
  const refusal = dagDeviceRefusal(lying.limits, packed);
  const cut = async (target: GPUDevice) => {
    // The readout keeps the catalogue's cap on both devices: a list sized from the reported
    // binding would truncate the split cut alone (`listCap.ts`).
    const resources = await createDagResources(
      target,
      packed,
      false,
      null,
      selectionListCap(packed.pageCount),
    );
    if (!resources) return undefined;
    const readback = device.createBuffer({
      size: resources.readbackBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const cuts = [];
    for (const pixelError of pixelErrors) {
      const block = new Float32Array(DAG_UNIFORM_BYTES / 4);
      writeDagUniforms(block, packed, { ...uniforms, pixelError }, false, resources.listCap);
      device.queue.writeBuffer(resources.uniforms, 0, block);
      const encoder = device.createCommandEncoder();
      encodeDagKernels(encoder, resources);
      encoder.copyBufferToBuffer(resources.output, 0, readback, 0, resources.readbackBytes);
      device.queue.submit([encoder.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const result = parseDagOutput(readback.getMappedRange(), 0, resources.readbackBytes, 0);
      readback.unmap();
      if (!result) throw new Error('unreadable output');
      cuts.push({
        pixelError,
        pageIds: [...result.pageIds].sort((a, b) => a - b),
        frustumRejected: result.frustumRejected,
        selectedTriangles: result.selectedTriangles,
      });
    }
    const parts = { nodes: resources.nodeParts.buffers.length, flags: resources.flagParts.length };
    for (const buffer of [...resources.buffers, readback]) buffer.destroy();
    return { ranges: resources.ranges.length, parts, cuts };
  };
  const whole = await cut(device);
  const split = refusal ? undefined : await cut(lying);
  const storageBindings = device.limits.maxStorageBuffersPerShaderStage;
  const info = await gpu.fermer();
  return {
    adapter: info.court,
    storageBindings,
    refusal,
    errors,
    whole,
    split,
  };
}
