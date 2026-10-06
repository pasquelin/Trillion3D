/** The Jolt commit the engine's physics module is built from: the pin of the submodule
 *  `packages/physics-jolt-wasm/JoltPhysics`, which the compiler's cook reads (`build.rs`). A test
 *  fails while the two differ (`joltCommit.test.ts`). */
export const JOLT_COMMIT = 'e77f175595e64cb44218cc9d9d56fc365ad0e36a'
