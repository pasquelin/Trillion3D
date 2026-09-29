/**
 * Page side of the frame-ranges probe (#979): the engine's real cut (`createDagResources`,
 * `encodeDagKernels`) on a real device, once whole and once through a device whose reported
 * binding limit holds a third of the primitives' `frames` — the same device underneath, so only
 * the capacity the cut reads changes (`frameRanges.ts`), and the table splits into three ranges.
 */
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { createDagResources } from '../../../packages/sdk-browser/src/gpu/dag/resources.ts';
import { encodeDagKernels } from '../../../packages/sdk-browser/src/gpu/dag/encode.ts';
import {
  writeDagUniforms,
  parseDagOutput,
} from '../../../packages/sdk-browser/src/gpu/dag/uniforms.ts';
import { framesBytes } from '../../../packages/sdk-browser/src/gpu/dag/frameRanges.ts';
import { selectionListCap } from '../../../packages/sdk-browser/src/gpu/dag/layout.ts';
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import { sceneView } from './cutDispatchesScene.ts';
import { openGpuDevice } from './webgpuDevice.ts';

/** Sixty placements of a pyramid eight levels deep, spread across and beyond the view; the first
 *  range's twenty behind the camera, so the later ranges' nodes open each queue a level reuses. */
const poses = Array.from({ length: 60 }, (_, k) =>
  new G.Matrix4().makeTranslation(((k % 10) - 4.5) * 4, 0, k < 20 ? 60 : -Math.floor(k / 10) * 6),
);

/** The device, its limits saying `binding` bytes per storage binding: what the cut sizes from. */
const reporting = (device: GPUDevice, binding: number) =>
  new Proxy(device, {
    get: (target, key) => {
      if (key === 'limits') return { maxBufferSize: binding, maxStorageBufferBindingSize: binding };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

export async function executer(pixelErrors: number[]) {
  const appareil = await openGpuDevice();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const { packed, uniforms } = sceneView(400, 8, poses);
  const third = framesBytes(Math.ceil(packed.worldCount / 3));
  const cut = async (target: GPUDevice) => {
    // The readout keeps the catalogue's cap on both devices: only `frames` is to split, and a list
    // sized from the lying binding would truncate the split cut alone (`listCap.ts`).
    const resources = await createDagResources(
      target,
      packed,
      false,
      null,
      selectionListCap(packed.pageCount),
    );
    if (!resources) throw new Error('the cut does not mount');
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
    for (const buffer of [...resources.buffers, readback]) buffer.destroy();
    return { ranges: resources.ranges.length, cuts };
  };
  const whole = await cut(device);
  const split = await cut(reporting(device, third));
  const info = await appareil.fermer();
  return { adaptateur: info.court, erreurs, whole, split };
}
