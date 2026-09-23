# Unified SDK facade contract

Version 0.2.0 exposes one consumer specifier, `web-geometry`. The source facade has three
environment branches:

| Resolver context                        | Source facade             | Public surface                | Declaration constraints                                                               |
| --------------------------------------- | ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| Node ESM with NodeNext                  | `packages/sdk/node.mts`   | Common and native compilation | Node types are allowed; DOM and WebGPU types are not introduced by the common branch. |
| Browser bundler with TypeScript Bundler | `packages/sdk/browser.ts` | Common and browser rendering  | Browser and WebGPU declarations are allowed; no `node:*` module is reachable.         |
| Worker or common code                   | `packages/sdk/index.ts`   | Common maths and contracts    | Compiles without DOM or WebGPU declarations.                                          |
| Unknown environment or fallback         | `packages/sdk/index.ts`   | Common maths and contracts    | The safe default never exposes browser or Node APIs by accident.                      |

SSR resolves the Node branch. It therefore exposes native and common APIs, and does not expose
browser rendering APIs. Importing any branch has no startup action: it does not create a renderer,
worker, DOM object, GPU object or compiler process.

A fourth branch exists beside these three, and it is not a `web-geometry` resolver condition: the
measurement entry point, `packages/sdk-browser/src/measurement/measurement.ts`. It re-exports everything the
browser branch does, plus `openMeasuredWorld`/`createMeasuredWorldJob` (the internal session a
world opens on itself), the witness backend factories, `chooseBackends`/`autonomousCacheReady` and
`replicateInstances`. `package.json`'s `exports` map has no subpath for it — the bench, the proofs
and the comparison views import it by its source path inside this repository, never through the
published `web-geometry` specifier, so none of it reaches a consumer of the package.

The package maps these built files with conditional JavaScript and matching conditional
declarations. The `browser` condition precedes the Node and generic import/default paths; the Node
branch uses the standard `node` condition, and the final default remains the common branch.
Resolvers that ignore `browser` therefore receive the safe common facade instead of browser code.

`api-inventory.json` is generated with the TypeScript checker. It follows aliases and transitive
star exports, records binding identity and lists every current entry point. It also records the
documented source-path imports that the facade newly exposes. Experimental comparison and oracle
bindings stay classified as experimental. The world facade is a declared exception to "no binding is
removed": `createExplorer`, `createExplorerJob` and the six backend factories left the browser
branch for the measurement entry point above — renamed there to `openMeasuredWorld` and
`createMeasuredWorldJob` — so a host that imported them from `web-geometry` now imports
`createWorld` and its families instead.

With esbuild 0.25.12, ESM format, browser platform, minification and tree shaking enabled, a
consumer importing only `hierarchyUpdateBatch` is 5,245 bytes from the existing core entry and
1,780 bytes from the proposed common facade. The browser facade is 3,289 bytes because it retains
its existing public maths surface, while eliminating unrelated rendering code and every Node
module. This is a bundle-content measurement, not a runtime-performance claim.
