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
import {
  cameraFrameRanges,
  framesBytes,
} from '../../../packages/sdk-browser/src/gpu/dag/frameRanges.ts';
import {
  packDagSelection,
  packedWorldsToRenderOrigin,
} from '../../../packages/sdk-browser/src/gpu/dag/pack.ts';
import { cameraSelectionUniforms } from '../../../packages/sdk-browser/src/gpu/core/selection.ts';
import { cameraMoteur } from '../../../packages/sdk-browser/src/camera/camera.fixture.ts';
import { frontCamera } from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts';
import {
  scenePages,
  sceneRoots,
} from '../../../packages/sdk-browser/src/gpu/dag/cutFrontierScene.fixture.ts';
import { DAG_UNIFORM_BYTES } from '../../../packages/sdk-browser/src/gpu/dag/shader/viewsWgsl.ts';
import { ouvrirAppareil } from './webgpuDevice.ts';

/** `worlds` placements of a pyramid `niveaux` deep, spread across and beyond the view. */
function scene(worlds: number, feuilles: number, niveaux: number) {
  const poses = Array.from({ length: worlds }, (_, k) =>
    new G.Matrix4().makeTranslation(((k % 10) - 4.5) * 4, 0, -Math.floor(k / 10) * 6),
  );
  const roots = sceneRoots(scenePages(feuilles, niveaux), poses, true);
  const packed = packDagSelection(roots);
  const uniforms = cameraSelectionUniforms(cameraMoteur(frontCamera(16, 200)), 1, [1280, 720]);
  packedWorldsToRenderOrigin(packed, roots, uniforms.cameraWorld);
  return { packed, uniforms };
}

/** A device whose limits say `binding` bytes per storage binding; everything else is the device's. */
function reporting(device: GPUDevice, binding: number): GPUDevice {
  const limits = {
    maxBufferSize: binding,
    maxStorageBufferBindingSize: binding,
    minUniformBufferOffsetAlignment: device.limits.minUniformBufferOffsetAlignment,
  };
  return new Proxy(device, {
    get: (target, key) => {
      if (key === 'limits') return limits;
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function executer({
  worlds,
  feuilles,
  niveaux,
  pixelErrors,
}: {
  worlds: number;
  feuilles: number;
  niveaux: number;
  pixelErrors: number[];
}) {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const { packed, uniforms } = scene(worlds, feuilles, niveaux);
  const third = framesBytes(Math.ceil(packed.worldCount / 3));
  const cut = async (target: GPUDevice) => {
    const resources = await createDagResources(target, packed, false);
    if (!resources) throw new Error('the cut does not mount');
    const readback = device.createBuffer({
      size: resources.readbackBytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const cuts = [];
    for (const pixelError of pixelErrors) {
      const block = new Float32Array(DAG_UNIFORM_BYTES / 4);
      writeDagUniforms(block, packed, { ...uniforms, pixelError }, false);
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
  return {
    adaptateur: info.court,
    erreurs,
    worldCount: packed.worldCount,
    expectedRanges: cameraFrameRanges(
      { maxBufferSize: third, maxStorageBufferBindingSize: third },
      packed.worldCount,
    ).length,
    whole,
    split,
  };
}
