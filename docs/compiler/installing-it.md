# Installing it

`npm install trillion3d` brings the Node adapter and its machine's compiler. In a checkout,
`pnpm run build:native` builds it into `packages/asset-compiler-rust/target/release/`; the physics
cook links native Jolt from the pinned submodule, so the build needs CMake, a C++17 compiler and
`git submodule update --init`.

## Platform packages

The compiler is built for macOS arm64 and x64, Linux arm64 and x64 (glibc) and Windows x64, each
shipped as its own package, `@trillion3d/compiler-<os>-<arch>` (`packages/compiler/`), declared in
the `optionalDependencies` of `trillion3d`: an install takes only its machine's one. The `Compiler`
workflow builds the five (`scripts/native/compiler-dist.ts`) and checks that they write the same cache
bytes. A Linux on musl, or an install without optional dependencies, has no package
([Using it from Node](using-it-from-node.md#using-it-from-node) says how the executable is found).
