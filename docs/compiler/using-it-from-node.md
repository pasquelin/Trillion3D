# Using it from Node

`trillion3d` on Node relays to the executable
([`packages/sdk-node/src/index.mts`](../../packages/sdk-node/src/index.mts)) and reads the manifest
from disk:

```ts
import { prepare, prepareMany, createTerminalProgress } from 'trillion3d'

const progress = createTerminalProgress({ label: 'city' })
const result = await prepare('scenes/city/city.obj', 'cache/city', 'full', 150000, {
  resourceBaseUrl: '/assets/city/',
  threads: 8,
  ramBudgetMb: 8192,
  simplification: 'qem-endpoints',
  signal: controller.signal, // abort: a cancel line, then a kill after CANCEL_GRACE_MS
  onProgress: progress.event,
})
const summary = await prepareMany(jobs, { workers: 4, ramBudgetMb: 32768, threads: 4 })
```

`createTerminalProgress` draws one live line on a TTY, one line per phase elsewhere, then each
warning code once with count, worst case, cause, action (`verbose` adds info codes and every
occurrence); `createBatchProgress` does it per `prepareMany` job. `trillion3d-compile` wraps
`prepare`:

```
trillion3d-compile [--strict] [--verbose] [--hlod=JSON] [--temporal-antialiasing=LEVEL] [--responsive=JSON] [--materials=JSON] SOURCE CACHE [slice|full] [TRIANGLES] RESOURCE_BASE_URL [THREADS] [RAM_MB] [SIMPLIFICATION]
```

It prints raw JSON events on a pipe (`TRILLION3D_RAW_EVENTS=1` forces them), then the warning
summary as `message` events.

Executable: `options.executable`, else installed platform package's, else `TRILLION3D_COMPILER_BIN`,
else the checkout's build, refused with `COMPILER_STALE` while a file its build hashed (list
`--build-inputs` prints, asked once per build), or the physics cook and message catalogue it reads
beside them, is newer (`pnpm run build:native`). A machine no package serves fails with
`COMPILER_PLATFORM_UNSUPPORTED`, a missing package with `COMPILER_EXECUTABLE_MISSING`
(`packages/sdk-node/src/compiler/executable.mts`).

A material keeps its source-authored blend mode (glTF `alphaMode`, or the importer's value from the
source material: `OPAQUE`, `MASK` with cutoff, `BLEND`): the compiler measures no texture alpha and
reclassifies nothing. A foliage material declared blended draws blended; to draw it masked, declare
it `MASK` in the source.
