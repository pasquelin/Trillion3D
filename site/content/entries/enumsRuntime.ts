import type { EntryNote } from '../model.ts';

/** Constants and enums of the runtime: math path, jobs, capabilities, timings, format, sides. */

export const ENUMS_RUNTIME: EntryNote[] = [
  {
    id: 'MathPathMode',
    valueNames: ["'auto'", "'js'", "'wasm'"],
    example: `import { MATH_PATH_CONTRACT, createPathGovernor } from 'trillion3d';

const governor = createPathGovernor(performance.now.bind(performance), 'auto');
console.log(MATH_PATH_CONTRACT, governor.metrics()); // per operation: jsNsPerElement, wasmNsPerElement, path, switches`,
  },
  {
    id: 'JobStatus',
    valueNames: ["'queued'", "'running'", "'completed'", "'cancelled'", "'failed'"],
    example: `const job = createJob('city', ({ signal, progress }) => prepareScene(signal, progress));
job.subscribe(() => console.log(job.getSnapshot().status, job.getSnapshot().progress));
await job.promise; // job.cancel(reason) aborts it and disposes what it owned`,
  },
  {
    id: 'CapabilityTier',
    valueNames: ["'full'", "'degraded'", "'baseline'"],
    example: `const policy = createSafetyPolicy({ minimumSamples: 8, consecutiveViolations: 3, /* ... */ });
const decision = policy.observe(reference, candidate, now); // { tier, enabled, reason, changedAt, revision }
policy.trip('device-lost', now); // straight to the safe path`,
  },
  {
    id: 'GpuTimingMethod',
    valueNames: ["'timestamp-query'", "'EXT_disjoint_timer_query_webgl2'"],
    example: `const frame = metric.frame(world);
console.log(frame.gpuFrameMs); // null when nothing measured it`,
  },
  {
    id: 'ColumnKind',
    valueNames: ["'f64'", "'i32'", "'u32'", "'u8'"],
    example: `import { COLUMN_KIND } from 'trillion3d';

console.log(COLUMN_KIND.pageBounds); // 'f64'`,
  },
  {
    id: 'Side-common',
    valueNames: ["'front'", "'back'", "'double'"],
    replaces: 'FrontSide, BackSide, DoubleSide',
    proof: 'materialSide.test.ts',
    example: `// Read once at the import boundary.
import { sideOf } from 'trillion3d';

if (sideOf(material) === 'double') { /* rasterize without backface culling */ }`,
  },
];
