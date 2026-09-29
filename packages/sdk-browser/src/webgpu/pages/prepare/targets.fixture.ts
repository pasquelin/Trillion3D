import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts';
import { standardSurface } from '../../../host/graph/graph.fixture.ts';
import { surfaceOf } from '../../../page/surface.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** An engine reduced to its targets, with a dummy temporal pass that notes its resizes. */
export function runtime(reflective = false) {
  const resized: number[][] = [],
    failures: string[] = [];
  const temporal = {
    frame: { hasHistory: true, stillFrames: 5 },
    resize(w: number, h: number) {
      resized.push([w, h]);
      return true;
    },
    release() {},
    dispose() {},
  };
  const rt = {
    setup: { reserveHiz: true },
    run: { diagnostic: 'beauty' },
    layout: {
      rows: {
        packedCount: reflective ? 1 : 0,
        packedRecs: reflective ? [{ material: surfaceOf(standardSurface({ roughness: 0 })) }] : [],
      },
    },
    blendState: { blendGpu: [] },
    context: {},
    gpu: { device: fakeDevice({ limits: { maxTextureDimension2D: 8192 } }).device, temporal },
    capture: { capturing: false },
    capabilities: { unsupported: [] as string[] },
    diag: { diagnosticFailure: (phase: string) => failures.push(phase) },
  } as unknown as WebgpuPagesRuntime;
  return { rt, temporal, resized, failures };
}
