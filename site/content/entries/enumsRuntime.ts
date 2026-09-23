import type { EntryNote } from '../model.ts';

/** Constants and enums of the runtime: math path, jobs, capabilities, timings, format, sides. */

export const ENUMS_RUNTIME: EntryNote[] = [
  {
    id: 'MathPathMode',
    description:
      'Which path a batch runs on. `auto` arbitrates by measurement: the governor keeps a sliding median of nanoseconds per element on each side and switches after a burst of executions at that lead, JS staying the reference and the fallback. `MATH_PATH_CONTRACT` versions the published report.',
    values: [
      { name: "'auto'", desc: 'Arbitration by measurement (the default).' },
      { name: "'js'", desc: 'The JavaScript path imposed, for a campaign.' },
      {
        name: "'wasm'",
        desc: 'The WebAssembly kernel imposed, when one exists for that operation.',
      },
    ],
    example: `import { MATH_PATH_CONTRACT, createPathGovernor } from 'web-geometry';

const governor = createPathGovernor(performance.now.bind(performance), 'auto');
console.log(MATH_PATH_CONTRACT, governor.metrics()); // per operation: jsNsPerElement, wasmNsPerElement, path, switches`,
  },
  {
    id: 'JobStatus',
    description:
      'Lifecycle of a job created by `createJob` — a compilation, a world creation. A cancelled or failed job disposes the result it owned.',
    values: [
      { name: "'queued'", desc: 'Created, not started.' },
      { name: "'running'", desc: 'Running; `progress` events carry a phase and a count.' },
      { name: "'completed'", desc: 'Resolved; `result` holds the value.' },
      { name: "'cancelled'", desc: 'Aborted through its `AbortSignal`.' },
      { name: "'failed'", desc: 'Threw; `error` holds `{ code, message }`.' },
    ],
    example: `const job = createJob('city', ({ signal, progress }) => prepareScene(signal, progress));
job.subscribe(() => console.log(job.getSnapshot().status, job.getSnapshot().progress));
await job.promise; // job.cancel(reason) aborts it and disposes what it owned`,
  },
  {
    id: 'CapabilityTier',
    description:
      'What the safety policy decides a session may run, from measured costs. A `SafetyDecision` carries the tier, whether the feature is enabled, the reason, and when it changed.',
    values: [
      { name: "'full'", desc: 'Every measured cost within budget.' },
      { name: "'degraded'", desc: 'A budget exceeded: the feature is reduced.' },
      { name: "'baseline'", desc: 'The safe path, the feature disabled.' },
    ],
    example: `const policy = createSafetyPolicy({ minimumSamples: 8, consecutiveViolations: 3, /* ... */ });
const decision = policy.observe(reference, candidate, now); // { tier, enabled, reason, changedAt, revision }
policy.trip('device-lost', now); // straight to the safe path`,
  },
  {
    id: 'GpuTimingMethod',
    description:
      'How the GPU durations of a stage profile were taken. A per-pass duration says where, never how much: on a tile-based GPU passes overlap and a pass absorbs its neighbours. The frame total is `gpuImageMs`, the envelope — stage durations do not add into it.',
    values: [
      { name: "'timestamp-query'", desc: 'Native WebGPU timestamp queries.' },
      { name: "'EXT_disjoint_timer_query_webgl2'", desc: 'The WebGL2 extension, for that path.' },
    ],
    example: `const frame = metric.frame(world);
console.log(frame.gpuFrameMs); // null when nothing measured it`,
  },
  {
    id: 'ColumnKind',
    description:
      'Storage of one column of the binary manifest. `COLUMN_KIND` maps each column name to its kind, so a reader knows the view to take over the sidecar bytes.',
    values: [
      { name: "'f64'", desc: 'Bounds, spheres, errors, culling nodes.' },
      { name: "'i32'", desc: 'Signed indices — page integers, group levels.' },
      { name: "'u32'", desc: 'Unsigned counters and offsets.' },
      { name: "'u8'", desc: 'Raw bytes — SHA objects, preview pixels.' },
    ],
    example: `import { COLUMN_KIND } from 'web-geometry';

console.log(COLUMN_KIND.pageBounds); // 'f64'`,
  },
  {
    id: 'Side-common',
    description:
      'Which faces of a surface are drawn — every raster, cone, pipeline and blend-plan decision compares against it. Two readers of `packages/sdk-browser/src/scene/materialSide.ts` stand between it and a host: `sideOf(material: HostMaterials): Side` reads what a host material declares, once at the import boundary, the only place naming the host constants; `materialSide(material: HostMaterials): number` returns that host constant itself, for the diagnostic materials still built with the host library.',
    values: [
      { name: "'front'", desc: 'Front faces only (an empty material array gives this).' },
      { name: "'back'", desc: 'Back faces only.' },
      { name: "'double'", desc: 'Both, for leaves, fabric and thin cut-outs.' },
    ],
    replaces: 'FrontSide, BackSide, DoubleSide',
    proof: 'materialSide.test.ts',
    example: `// Read once at the import boundary.
import { sideOf } from 'web-geometry';

if (sideOf(material) === 'double') { /* rasterize without backface culling */ }`,
  },
];
