// The animation worker (`animationWorker.ts`) as a Node thread runs it: the SDK module prepared
// first (`../wasm/sdkWasm.fixture.ts`), then the worker's own entry.
import '../wasm/sdkWasm.fixture.ts'

await import('./animationWorker.ts')
