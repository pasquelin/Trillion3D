// The real WebGPU engine on the repository's cluster DAG fixture (`dag.fixture.ts`), as the proofs
// of a cut held under a small residency budget and of a lost device mount it.
import type {
  EngineContext,
  EngineDiagnostic,
} from '../../../packages/sdk-browser/src/engine/types.ts'
import { webgpuPagesEngine } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts'
import { dagFixture } from '../../../packages/sdk-browser/src/page/selection/dag.fixture.ts'

/** The engine on a fresh DAG fixture, on `device`, at 128 × 128 and the finest cut, its diagnostics
 *  pushed to `events`; `options` completes the context. The fixture comes back beside it. */
export function dagFixtureEngine(
  device: GPUDevice,
  events: Pick<EngineDiagnostic, 'phase' | 'message' | 'context'>[],
  options: Partial<EngineContext>,
) {
  const fixture = dagFixture()
  const backend = webgpuPagesEngine({
    source: fixture.source,
    metadata: fixture.metadata,
    indices: fixture.indices,
    draws: fixture.draws,
    gpuDevice: device,
    viewport: [128, 128],
    pixelError: 0,
    clearColor: 0x000000,
    diagnosticDetail: 'summary',
    onDiagnostic: (e) => events.push({ phase: e.phase, message: e.message, context: e.context }),
    ...options,
  })
  return { fixture, backend }
}
