# Package architecture — version 0.2.0

This repository builds ESM JavaScript and TypeScript declarations into `dist/`, behind one public
specifier, `web-geometry` ([SDK_FACADE.md](../docs/SDK_FACADE.md)). npm publication and
cross-platform binary distribution are not configured.

| Package               | Public API                                                                             | Implementation                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sdk-core`            | versioned contracts, maths and batches, jobs, progress and cancellation, safety policy | pure TypeScript, no DOM, platform or UI import                                                                                                                       |
| `sdk-browser`         | `createWorld` and its families ([SDK.md](../docs/SDK.md#families))                     | the WebGPU page raster and the WebGL2 page path, streaming, virtual textures, lighting, controls; witnesses and internal sessions behind the measurement entry point |
| `sdk-node`            | `prepare`, `prepareMany`, `createCompilationJob`, the `web-geometry-compile` CLI       | native process and job adapter and its filesystem boundary                                                                                                           |
| `sdk`                 | the `web-geometry` facade                                                              | the common, browser and Node branches                                                                                                                                |
| `page-codec`          | `encodeGeometryPage(indices, attributes)`                                              | a second, TypeScript encoder of geometry pages, so the browser decoder is tested against an independent implementation; not a production path                        |
| `page-codec-wasm`     | none directly                                                                          | the WebAssembly page decoder and the three math kernels the governor may play ([SDK.md](../docs/SDK.md#batch-math-for-hosts))                                        |
| `asset-compiler-rust` | Rust `compile(options, progress)` and the `web-geometry-compiler` binary               | format drivers, cluster DAG, culling hierarchy, quantized pages, baked and block-compressed textures, lights, proxy, SHA-addressed objects, Rayon pool               |

How a world draws is [ENGINE.md](../docs/ENGINE.md); the compiler is
[COMPILER.md](../docs/COMPILER.md); the cache is [FORMAT.md](../docs/FORMAT.md).

## Native library

Build and test with `pnpm run build:native` and `pnpm run test:native`.

The library maps the source binary read-only; the host keeps input files immutable during the call.
It verifies manifest, glTF and binary hashes, preserves source index order and material flags,
shares identical objects by SHA-256 and checks cached bytes before reuse. A completed manifest is
published last under `native/<scope>/manifest.json`; interrupted temporary files are never cache
hits. Progress events come from parallel workers and may interleave; output order and identities are
deterministic for a given implementation.

The compiler emits one hierarchy, the cluster DAG (`clusterStrategy: 'dag-groups'`). Level 0
partitions the source triangles into clusters of at most 128 triangles; each level groups 8 to 32
neighbouring clusters, simplifies the merged group with the vertices it shares with other groups
locked, and re-splits the result. Cache keys include the source manifest, binary hashes, compiler
version and implementation hash, scope, budget, resource URL, simplification and error model.

Thread count is enforced by a local Rayon pool. The RAM option is an admission estimate, not an
OS-enforced peak RSS cap. The cancellation token is checked between primitives and pages; the Node
adapter cancels the subprocess through `AbortSignal` and bounds both stdout and stderr.

## Release work still required

- Each production phase — import, normalization, clustering, simplification, grouping, pages,
  compression, validation — still lacks its own replaceable, versioned input/output strategy; the
  library still performs filesystem operations behind no storage port.
- No N-API binding of the compiler: the executable and its three streams are the integration.
- Release targets are macOS arm64/x64, Linux x64/arm64 and Windows x64; only macOS arm64 is built
  and run here. No signed artifact, installer or cross-platform performance gate exists yet.

## Hosts

An Electron main process imports `prepare` from `web-geometry`; source and cache directories, the
resource URL and the executable are host configuration. The host serves the outputs and the original
textures through its own URL or protocol, and the renderer process loads them with
`world.scene.load(manifestUrl)`. Progress travels through host-owned IPC; no core package imports
Electron. React consumes job snapshots with `useSyncExternalStore` and owns controls and canvas
disposal. No `sdk-react` or `sdk-electron` package exists: one will be written only when it carries
real lifecycle or IPC policy.

`SDK_VERSION` is independent of `FORMAT_VERSION` and of the compiler version. Jobs expose immutable
version-1 snapshots (`queued`, `running`, `completed`, `cancelled`, `failed`), progress, a result
promise, cancellation and subscription; observers cannot change the outcome.

## Safety and silent fallback

`createSafetyPolicy` accepts comparable measured reference and candidate costs, explicit budgets,
minimum sample counts, hysteresis ratios and a minimum switching period. It starts at baseline,
refuses invalid or incomparable evidence and trips immediately on errors, out-of-memory, device loss,
quality failures, memory pressure or measured thrashing. It is a decision policy, not a measurement
producer: callers supply real measurements, and no threshold is claimed to be calibrated.

Normal use stays silent on recovered fallbacks. `RuntimeEvent` messages for capability negotiation,
optimization and recovered errors carry `audience: 'diagnostic'`; `userNotice(event)` returns no
notice for them. Only an unrecoverable event produces a localizable `scene-unavailable` notice with a
retry action, never low-level driver text. The SDK emits no modal, console warning or DOM message.
