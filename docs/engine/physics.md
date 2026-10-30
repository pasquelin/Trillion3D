# Physics

The page's side is [PHYSICS.md](../PHYSICS.md). Jolt Physics is built into one standalone module
behind a flat C API (`packages/physics-jolt-wasm/src/`), loaded by `physics/joltModule.ts` and
stepped by a worker (`physics/physicsWorker.ts`) on the frames' clock (`physics/step/stepClock.ts`);
the buffer layouts are `packages/sdk-core/src/physics/layout.ts`. Everything the physics draws is
drawn between two steps by one mechanism (`physics/step/twoSteps.ts`).
