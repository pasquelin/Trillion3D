# Installation and environment API

Installing, the CDN `importmap` and the licence: [README](../../README.md#quick-start).
`npm install trillion3d`
takes only its machine's compiler package ([COMPILER.md](../compiler/installing-it.md#platform-packages)).

A strict browser TypeScript project enables the `browser` condition; without it, Bundler resolution
selects the common declarations, which lack `createWorld`.

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "customConditions": ["browser"],
    "lib": ["ES2023", "DOM"],
    "types": ["@webgpu/types"],
  },
}
```

A browser host installs `trillion3d` and, for its types, `@webgpu/types`; nothing else: the
package ships no rendering library (`tests/integration/installed-package.test.ts`).

A Node TypeScript host uses `"module": "NodeNext"`, `"moduleResolution": "NodeNext"` and
`"types": ["node"]`; NodeNext then selects the Node declarations from the same specifier.

A page without a bundler imports `trillion3d/module`. A bundler takes `trillion3d` as the entry, the
installed workers (`pageWorker.js`, `pageIntegrationWorker.js`, `physicsWorker.js`) as
module-worker entries, and code splitting; copy each installed WebAssembly
module (`kernels.wasm`, `joltPhysics.wasm`, `joltPhysicsThreads.wasm`) beside every chunk that
names it, and serve that output with the compiled scene cache. `pnpm run proof:package -- --browser`
is the repository's executable esbuild configuration (`-- --bundle` without a browser).

Electron runs `prepare` in the main process and `createWorld` in the renderer
([hosts](../../packages/README.md#hosts)); another language spawns the compiler and reads the
versioned cache ([COMPILER.md](../compiler/using-it-from-any-other-host.md#using-it-from-any-other-host)).
