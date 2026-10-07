# Third-party notices

Trillion3D ships the following third-party software in its builds. Each keeps its own licence.

## Jolt Physics

- Source: https://github.com/jrouwe/JoltPhysics, pinned as the git submodule
  `packages/physics-jolt-wasm/JoltPhysics` (tag `v5.6.0`); its sources are not copied into this
  repository.
- Shipped as: `packages/sdk-browser/src/physics/joltPhysics.wasm` and
  `packages/sdk-browser/src/physics/joltPhysicsThreads.wasm` (the threaded build), both built from
  those sources by `scripts/build-physics-wasm.ts`. This notice travels with them: in the npm
  package, and beside them in the site's `docs/runtime/`.
- Licence: MIT.

```text
Copyright 2021 Jorrit Rouwe

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## draco-core

- Source: https://github.com/Filyus/draco-rust, crate `draco-core` pinned at `2.1.0`.
- Shipped in: the native asset compiler, for `KHR_draco_mesh_compression` decoding.
- Licence: Apache-2.0; see https://www.apache.org/licenses/LICENSE-2.0.
- Only mesh decoding and EdgeBreaker valence decoding are enabled; no encoder or point-cloud decoder is linked.

## mimalloc

- Linked into the native compiler binary as its allocator (#1352), through the crates `mimalloc`
  and `libmimalloc-sys`, versions pinned in `packages/asset-compiler-rust/Cargo.lock`.
- Source: https://github.com/microsoft/mimalloc and https://github.com/purpleprotocol/mimalloc_rust.
- Licence: MIT; copyright (c) 2018-2021 Microsoft Corporation, Daan Leijen, and (c) 2019 Octavian
  Oncescu. Notices kept with the dependency.

## libm (fdlibm's arc cosine and sine)

- Source: https://github.com/rust-lang/libm, crate `libm` pinned at `0.2.16`, itself from musl and
  Sun's fdlibm.
- Shipped as:
  - the arc cosine of `packages/page-codec-wasm/src/acos.rs`, transcribed from `libm`'s
    `src/math/acos.rs` with the instruction's square root, and the sine of
    `packages/page-codec-wasm/src/trig.rs`, transcribed from `src/math/sin.rs`, `k_sin.rs`,
    `k_cos.rs` and `rem_pio2.rs` (below 2^20 · π/2), both inside
    `packages/sdk-browser/src/math/wasm/kernels.wasm`;
  - their TypeScript twins `fdlibmAcos` and `fdlibmSin` of
    `packages/sdk-core/src/math/primitives/trig.ts`, from the same files, in the JavaScript
    bundles;
  - the native compiler links the crate itself.
- Licence: MIT (libm), with fdlibm's notice kept in each transcribed file.

```text
Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.

Developed at SunSoft, a Sun Microsystems, Inc. business.
Permission to use, copy, modify, and distribute this
software is freely granted, provided that this notice
is preserved.
```

```text
rust-lang/libm as a whole is available for use under the MIT license:

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## meshoptimizer (native compiler)

- Source: https://github.com/zeux/meshoptimizer. The C++ sources version 0.25 are carried and built
  by `cc` inside the Rust crate `meshopt` 0.6.2 (https://github.com/gwihlidal/meshopt-rs, licence
  MIT OR Apache-2.0), linked into the native asset compiler for the simplifier and the cluster
  builder; its flags are set by `.cargo/config.toml`.
- Licence: MIT.

```text
Copyright (c) 2016-2025 Arseny Kapoulkine

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Image and texture readers of the native compiler

Shipped in the native asset compiler, versions pinned in
`packages/asset-compiler-rust/Cargo.toml` and `Cargo.lock`; each crate's notices are kept with the
dependency. The fixtures that prove them are described in
[`tests/fixtures/formats/README.md`](tests/fixtures/formats/README.md).

| crate              | version | licence           | source                                                      | used for                                                                                                                            |
| ------------------ | ------- | ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `exr`              | 1.74.2  | BSD-3-Clause      | https://github.com/johannesvollmer/exrs                     | OpenEXR reads; pure Rust, without `unsafe`                                                                                          |
| `texture2ddecoder` | 0.1.2   | MIT or Apache-2.0 | https://github.com/UniversalGameExtraction/texture2ddecoder | GPU block reconstruction (BCn, ETC2, EAC, ASTC) for the `dds` and `ktx2` drivers, through the `image::blocks` foundation; pure Rust |
| `basisu`           | 0.1.0   | Apache-2.0        | https://github.com/marcogomez/basisu                        | Basis Universal payloads in KTX 2.0; pure Rust, its output verified byte for byte against the format's decoder                      |
| `ruzstd`           | 0.7.3   | MIT               | https://github.com/KillingSpark/zstd-rs                     | Zstandard supercompression in KTX 2.0; pure Rust, decompression only                                                                |

## Other crates of the native compiler

Shipped in the native asset compiler, versions pinned in `packages/asset-compiler-rust/Cargo.lock`
(the `[dependencies]` of `packages/asset-compiler-rust/Cargo.toml`; its `[build-dependencies]` and
the `[dev-dependencies]` of `packages/page-codec-wasm/Cargo.toml` are not shipped). Where a crate is
dual-licensed "MIT OR Apache-2.0", both licences apply at your choice; the Apache-2.0 text is at
https://www.apache.org/licenses/LICENSE-2.0.

| crate        | version | licence           | source                                   | used for                                                                              |
| ------------ | ------- | ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------- |
| `ufbx`       | 0.11.3  | MIT OR PDDL-1.0   | https://github.com/ufbx/ufbx-rust        | FBX reading: the Rust binding and the C source of ufbx it carries, built by `cc`      |
| `openusd`    | 0.7.0   | MIT               | https://github.com/mxpv/openusd          | USD reading (`usda`, `usdc`, composition) for the `usd` and `usdz` drivers; pure Rust |
| `image`      | 0.25.10 | MIT OR Apache-2.0 | https://github.com/image-rs/image        | PNG, JPEG, TGA, TIFF, WebP, BMP and GIF reads                                         |
| `image-webp` | 0.2.4   | MIT OR Apache-2.0 | https://github.com/image-rs/image-webp   | WebP decoding, through `image`                                                        |
| `zip`        | 8.6.0   | MIT               | https://github.com/zip-rs/zip2           | ZIP archive reading (`zip` container driver)                                          |
| `flate2`     | 1.1.10  | MIT OR Apache-2.0 | https://github.com/rust-lang/flate2-rs   | gzip and deflate decompression, pure Rust backend                                     |
| `tar`        | 0.4.46  | MIT OR Apache-2.0 | https://github.com/composefs/tar-rs      | tar reading (`unitypackage` container driver)                                         |
| `yaml-rust2` | 0.13.0  | MIT OR Apache-2.0 | https://github.com/Ethiraric/yaml-rust2  | YAML reading for the `unitypackage` driver                                            |
| `serde_json` | 1.0.151 | MIT OR Apache-2.0 | https://github.com/serde-rs/json         | JSON reading and writing                                                              |
| `sha2`       | 0.10.9  | MIT OR Apache-2.0 | https://github.com/RustCrypto/hashes     | SHA-256 for cache identity                                                            |
| `rayon`      | 1.12.0  | MIT OR Apache-2.0 | https://github.com/rayon-rs/rayon        | data parallelism                                                                      |
| `memmap2`    | 0.9.11  | MIT OR Apache-2.0 | https://github.com/RazrFalcon/memmap2-rs | memory-mapped input files                                                             |
| `libc`       | 0.2.189 | MIT OR Apache-2.0 | https://github.com/rust-lang/libc        | process peak resident memory (`getrusage`)                                            |

The MIT licence of these crates, with the copyright lines of their licence files in the cargo
registry (`image`, `image-webp`, `serde_json`, `ufbx` and `openusd` carry no copyright line in the
files shipped with the crate, and `ufbx` and `openusd` carry no licence file):

```text
zip: Copyright (c) 2014 Mathijs van de Nes
flate2: Copyright (c) 2014-2026 Alex Crichton
tar: Copyright (c) The tar-rs Project Contributors
yaml-rust2: Copyright (c) 2015 Chen Yuheng; Copyright (c) 2023 Ethiraric
sha2: Copyright (c) 2006-2009 Graydon Hoare; Copyright (c) 2009-2013 Mozilla Foundation; Copyright (c) 2016 Artyom Pavlov
rayon: Copyright (c) 2010 The Rust Project Developers
memmap2: Copyright (c) 2020 Yevhenii Reizner; Copyright (c) 2015 Dan Burkert
libc: Copyright (c) The Rust Project Developers

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### Copyright lines and licence texts of `openusd`, `ufbx`, `image`, `image-webp` and `serde_json`

Read in the official repositories (`openusd` at https://github.com/mxpv/openusd/blob/main/LICENSE;
`ufbx` at https://github.com/ufbx/ufbx/blob/master/LICENSE and
https://github.com/ufbx/ufbx-rust/blob/master/LICENSE; `image` at tag `v0.25.10`, `image-webp` on
`main` and `serde_json` at tag `v1.0.151`, file `LICENSE-MIT`).

`openusd` 0.7.0 (MIT, the standard MIT text above), the copyright line of its `LICENSE` file:

```text
Copyright (c) 2024 Maksym Pavlenko
```

`image` 0.25.10, `image-webp` 0.2.4 and `serde_json` 1.0.151 (MIT OR Apache-2.0, the standard MIT text
above): their `LICENSE-MIT` files carry no copyright line, neither in the cargo registry nor in the
upstream repositories; none is added here.

`ufbx` 0.11.3: the crate manifest declares "MIT OR PDDL-1.0", while the `LICENSE` file of both
upstream repositories (`ufbx` and `ufbx-rust`) offers "ALTERNATIVE A - MIT License" or "ALTERNATIVE B - Public Domain (www.unlicense.org)". The crate and the `ufbx.c` it embeds carry no licence file. The
MIT alternative applies here, with the standard MIT text above and this copyright line:

```text
Copyright (c) 2020 Samuli Raivio
```

The `LICENSE` file of ufbx, as published upstream:

```text
------------------------------------------------------------------------------
This software is available under 2 licenses -- choose whichever you prefer.
------------------------------------------------------------------------------
ALTERNATIVE A - MIT License

Copyright (c) 2020 Samuli Raivio

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

------------------------------------------------------------------------------
ALTERNATIVE B - Public Domain (www.unlicense.org)

This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## FLIP (image difference metric, bench only)

- What it is: LDR-FLIP, the perceptual image difference metric of Andersson et al., "FLIP: A
  Difference Evaluator for Alternating Images" (NVIDIA, HPG 2020).
- Source: https://github.com/NVlabs/flip (official repository; reference tool `flip-evaluator` 1.7).
- Used by: `bench/runner/references/flip.ts`, a measurement tool. It is not shipped: the `files` of
  `package.json` lists only `dist` (without `dist/site` and `dist/witnesses`), a few documents and
  the licence files, and `bench/` is in none of them.
- This repository's implementation is written here from the published description; the colour-space
  constants are the algorithm's published ones; checked against the reference tool. The licence of
  the reference repository is kept here for the record.
- Licence: BSD-3-Clause.

```text
BSD 3-Clause License

Copyright (c) 2020-2025, NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Assets

Models and textures are not code and are listed apart. The licence of every asset the repository
uses, tracked or downloaded outside git, is in the table of
[`docs/ASSET_LICENSE_AUDIT.md`](docs/ASSET_LICENSE_AUDIT.md#licence-table-of-every-asset).
Credits for the models tracked by git under the site are in
[`site/assets/examples/CREDITS.md`](site/assets/examples/CREDITS.md): the street lamp and crate by
W. Sitters (CC BY 3.0), Marble Bust 01 by Rico Cilliers (CC0), CesiumMan (© 2017 Cesium, CC BY 4.0)
and AnimatedMorphCube (CC0). Elsewhere in git: the 200-triangle extract of A Beautiful Game
(© 2020 ASWF, © 2022 Ed Mackey, CC BY 4.0; `tests/fixtures/physics/`) and the Draco Box (© 2017
Cesium, CC BY 4.0; `tests/fixtures/formats/gltf/compressed-box/`). Sponza (Crytek), DamagedHelmet
and Duck are downloaded outside git for the bench and are not redistributed by this repository.
