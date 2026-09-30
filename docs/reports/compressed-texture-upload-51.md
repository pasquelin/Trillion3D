# Compressed texture upload (#51)

DDS BC1/2/3/4/5/7 and native KTX2 BCn, ETC2/EAC and ASTC 4×4 payloads now have a block-preserving route from the image driver to WebGPU. BasisLZ and UASTC transcode directly to a supported block codec, without an intermediate RGBA image. The image contract is `image-plugin-4`.

The compiler publishes `compressed-image-N.bin` with all mip payloads and their exact byte ranges. Source and prepared scene documents carry the format and mip dimensions; publication records include these products for integrity checks. Allocation budgets are checked before extracting blocks or constructing the Basis transcoder. Unsupported formats, premultiplied or transformed KTX2 containers retain the existing pixel path.

A prepared WebGPU scene reads these bytes only when its actual device supports the codec. Missing or invalid block products fall back to the existing baked images. The browser writes the block bytes with `GPUQueue.writeTexture`; it never gives a supported compressed source to `createImageBitmap`. The public `texture.compressed` constructor uses the same upload.

The GPU samples the native base level into the existing RGBA atlas scratch, then uses the existing material mip/coverage rule. This preserves the atlas architecture and avoids CPU expansion at upload; it does **not** make the whole atlas compressed or substitute authored mip filtering for the engine's rule. Temporary native textures are released after submission. The compiler still produces pixel fallbacks and previews for incompatible devices and pixel-dependent analysis.

Native block payload preservation is exact, including partial edge blocks, source subarray offsets and all authored mip levels. The reference for the decoded source is the declared codec's decoded texels; the copy uses an unfiltered linear view, without another sRGB conversion. Basis transcoding follows the selected target codec. No Chrome image comparison or hardware decoder rounding bound is claimed by these unit tests; image proof remains the recette's batch work under `CONTRIBUTING.md`.

## Reproduction

From the repository root, with Node 24, pnpm and Rust installed:

```sh
pnpm install --frozen-lockfile
git submodule update --init packages/physics-jolt-wasm/JoltPhysics
pnpm run build:native
pnpm run compile:caches
cargo test --locked -j 2 --manifest-path packages/asset-compiler-rust/Cargo.toml plugins::tests:: -- --test-threads=2
cargo test --locked -j 2 --manifest-path packages/asset-compiler-rust/Cargo.toml --lib tests::textures:: -- --test-threads=2
node --test --test-concurrency=2 packages/sdk-browser/src/texture/compressedUpload.test.ts packages/sdk-browser/src/host/prepared/imagesCompressed.test.ts packages/sdk-browser/src/webgpu/tile/scratchCompressed.test.ts
pnpm run check:changed
```

The native tests cover exact DDS block/mip retention below the RGBA allocation size, the native KTX2 path, both Basis encodings, and compiled sidecars compared with independently requested Basis target blocks. Browser tests cover feature refusal before allocation, exact upload bytes and extents, cache fallback on missing/truncated products, and the complete public texture-to-scratch path. GPU mocks verify upload and resource lifetime, not shader pixels or timing.

In the isolated issue worktree, the prepared-scene compatibility tests reuse the existing reference scene caches from the main checkout. Those fixtures were not recompiled for this change. The Rust publication test separately compiles fresh Basis/KTX2 products with the changed compiler and checks their actual bytes and scene-table references.

## Validation scope

The native plugin tests passed 58/58 with no ignored tests. The compiler texture tests passed 11/11; five pre-existing `regenerate_*` tests remain ignored because running them rewrites the golden fixtures. Fresh compressed-product publication is among the eleven executed tests.

The JavaScript gate has nine pre-existing conditional skips because this isolated worktree has no release compiler executable. No skip was added or changed:

| Existing suite                    | Skipped tests | Condition                                                                  |
| --------------------------------- | ------------: | -------------------------------------------------------------------------- |
| `world-partition-pages.test.ts`   |             4 | Missing release compiler: paged roots, WebGL2 zoom/scale and page lifetime |
| `world-partition-parents.test.ts` |             2 | Missing release compiler: moved/scaled placement parents                   |
| `world-partition.test.ts`         |             3 | Missing release compiler: page/framing camera reach for synthetic worlds   |

These cases are not counted as successful executions. GPU mocks test byte transport, capability fallback and cleanup; they do not replace hardware image proof.

Final `pnpm run check:changed`: **exit 0**, 1,457 JavaScript tests — **1,448 passed, 0 failed, 9 skipped** — in 297,042 ms. Format, lint, types/build, duplicate detection, unused exports, links, language checks and release Clippy passed. The conditional skips are listed above and are not counted as passes.
