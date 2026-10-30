# Entry points

`trillion3d` 1.0.0 has one specifier with three environment branches, plus one prebuilt module:

| Import              | Resolver context                        | Source                      | Surface                                                                                                                                         |
| ------------------- | --------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `trillion3d`        | Node ESM, `node` condition              | `packages/sdk/node.mts`     | common and native compilation; Node types, no DOM or WebGPU                                                                                     |
| `trillion3d`        | browser bundler, `browser` condition    | `packages/sdk/browser.ts`   | common and browser rendering; no `node:*` module reachable                                                                                      |
| `trillion3d`        | worker, common code, any other resolver | `packages/sdk/index.ts`     | common maths and contracts; no DOM, WebGPU, filesystem or process API                                                                           |
| `trillion3d/module` | a page without a bundler, a CDN         | `dist/trillion3d.module.js` | the browser branch built as one module, its workers, WebAssembly and chunks beside it ([README](../../README.md#public-sdk)); browser declarations |

`browser` precedes `node`, and the final default is the common branch: a resolver that ignores
`browser` or has no platform condition gets the safe common facade. SSR resolves the Node branch.
Importing any branch creates no renderer, worker, DOM object, GPU object or compiler process.

The measurement entry point (`packages/sdk-browser/src/measurement/measurement.ts`: the browser
branch plus the measured world, the backend factories and choice) has no subpath in `exports`, so
it never reaches a package consumer; `bench/witnesses/measurement.ts` adds the witness entry.

`apiInventory()` (`scripts/sdkApi/sdk-api-inventory.ts`) lists, with the TypeScript checker, every entry
point and binding the facades expose.
