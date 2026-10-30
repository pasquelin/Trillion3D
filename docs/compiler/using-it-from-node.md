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

`createTerminalProgress` draws one live line on a TTY, one line per phase elsewhere, then tells
each warning code once with its count, worst case, cause and action (`verbose` adds the info codes
and every occurrence); `createBatchProgress` does it per job of `prepareMany`. The
`trillion3d-compile` command wraps `prepare`:

```
trillion3d-compile [--strict] [--verbose] [--hlod=JSON] [--temporal-antialiasing=LEVEL] [--responsive=JSON] [--materials=JSON] SOURCE CACHE [slice|full] [TRIANGLES] RESOURCE_BASE_URL [THREADS] [RAM_MB] [SIMPLIFICATION]
```

It prints the raw JSON events on a pipe (`TRILLION3D_RAW_EVENTS=1` forces them), then the warning
summary as `message` events.

The executable is `options.executable`, else the installed platform package's, else
`TRILLION3D_COMPILER_BIN`, else the checkout's build, refused with `COMPILER_STALE` while a file
its build hashed — the list `--build-inputs` prints, asked once per build — or the physics cook and
message catalogue it reads beside them is newer (`pnpm run build:native`). Elsewhere, a machine no package serves fails with
`COMPILER_PLATFORM_UNSUPPORTED`, a missing package with `COMPILER_EXECUTABLE_MISSING`
(`packages/sdk-node/src/compiler/executable.mts`).

A material keeps the blend mode its source authored — glTF's `alphaMode`, or the value the importer
reads from the source's own material (`OPAQUE`, `MASK` with its cutoff, `BLEND`) —: the compiler
measures no texture's alpha and reclassifies nothing. A foliage material whose source declares it
blended is drawn blended; to draw it masked, declare it `MASK` in the source.
