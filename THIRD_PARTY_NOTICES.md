# Third-party notices

Trillion3D ships the following third-party software in its builds. Each keeps its own licence.

## Jolt Physics

- Source: https://github.com/jrouwe/JoltPhysics, pinned as the git submodule
  `packages/physics-jolt-wasm/JoltPhysics` (tag `v5.6.0`); its sources are not copied into this
  repository.
- Shipped as: `packages/sdk-browser/src/physics/joltPhysics.wasm` and
  `packages/sdk-browser/src/physics/joltPhysicsThreads.wasm` (the threaded build), both built from
  those sources by `scripts/build/build-physics-wasm.ts`. This notice travels with them in the npm
  package.
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
  - the arc cosine of `packages/math/rust/src/scalar/acos.rs` (crate `trillion3d-math`), transcribed
    from `libm`'s `src/math/acos.rs` with the instruction's square root, and the sine of
    `packages/math/rust/src/scalar/trig.rs` (same crate), transcribed from `src/math/sin.rs`, `k_sin.rs`,
    `k_cos.rs` and `rem_pio2.rs` (below 2^20 · π/2), both inside
    `packages/sdk-browser/src/wasm/kernels.wasm` and the native compiler;
  - their TypeScript twins `fdlibmAcos` and `fdlibmSin` of
    `packages/math/src/float/trig.ts`, from the same files, in the JavaScript
    bundles;
  - the native compiler links the crate itself, through its dependencies' `num-traits`.
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
  MIT OR Apache-2.0), linked into the native asset compiler to decode `EXT_meshopt_compression`;
  its flags are set by `.cargo/config.toml`.
- Licence: MIT.

```text
Copyright (c) 2016-2025 Arseny Kapoulkine

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## UVAtlas (simplified HLOD layers' charts and atlas)

- Source: https://github.com/microsoft/UVAtlas.
- Shipped as: a port to Rust, inside the native asset compiler, of its partition (the isochart
  spectral charting: geodesic distances, landmark multidimensional scaling, shape recognition,
  graph-cut border optimisation with its max-flow, stretch optimisation, chart merging with
  barycentric layouts) and its packer, in
  `packages/asset-compiler-rust/src/hlod/flatten/uv/spectral.rs` and `spectral/**`.
- Licence: MIT.

```text
The MIT License (MIT)

Copyright (c) 2017 Microsoft Corp

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
dual-licensed "MIT OR Apache-2.0" (or, for `bytemuck`, "Zlib OR Apache-2.0 OR MIT"), the licences
apply at your choice — the MIT one is used here —; the Apache-2.0 text is at
https://www.apache.org/licenses/LICENSE-2.0.

| crate               | version | licence                   | source                                          | used for                                                                                                                             |
| ------------------- | ------- | ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ufbx`              | 0.11.3  | MIT OR PDDL-1.0           | https://github.com/ufbx/ufbx-rust               | FBX reading: the Rust binding and the C source of ufbx it carries, built by `cc`                                                     |
| `openusd`           | 0.7.0   | MIT                       | https://github.com/mxpv/openusd                 | USD reading (`usda`, `usdc`, composition) for the `usd` and `usdz` drivers; pure Rust                                                |
| `image`             | 0.25.10 | MIT OR Apache-2.0         | https://github.com/image-rs/image               | PNG, JPEG, TGA, TIFF, WebP, BMP and GIF reads                                                                                        |
| `image-webp`        | 0.2.4   | MIT OR Apache-2.0         | https://github.com/image-rs/image-webp          | WebP decoding, through `image`                                                                                                       |
| `zip`               | 8.6.0   | MIT                       | https://github.com/zip-rs/zip2                  | ZIP archive reading (`zip` container driver)                                                                                         |
| `flate2`            | 1.1.10  | MIT OR Apache-2.0         | https://github.com/rust-lang/flate2-rs          | gzip and deflate decompression, pure Rust backend                                                                                    |
| `tar`               | 0.4.46  | MIT OR Apache-2.0         | https://github.com/composefs/tar-rs             | tar reading (`unitypackage` container driver)                                                                                        |
| `yaml-rust2`        | 0.13.0  | MIT OR Apache-2.0         | https://github.com/Ethiraric/yaml-rust2         | YAML reading for the `unitypackage` driver                                                                                           |
| `serde_json`        | 1.0.151 | MIT OR Apache-2.0         | https://github.com/serde-rs/json                | JSON reading and writing                                                                                                             |
| `block_compression` | 0.10.0  | MIT                       | https://github.com/hasenbanck/block_compression | BC7 encoding of every baked texture level; vendored and patched (below)                                                              |
| `sha2`              | 0.10.9  | MIT OR Apache-2.0         | https://github.com/RustCrypto/hashes            | SHA-256 for cache identity                                                                                                           |
| `rayon`             | 1.12.0  | MIT OR Apache-2.0         | https://github.com/rayon-rs/rayon               | data parallelism                                                                                                                     |
| `memmap2`           | 0.9.11  | MIT OR Apache-2.0         | https://github.com/RazrFalcon/memmap2-rs        | memory-mapped input files                                                                                                            |
| `libc`              | 0.2.189 | MIT OR Apache-2.0         | https://github.com/rust-lang/libc               | process peak resident memory (`getrusage`)                                                                                           |
| `wgpu`              | 30.0.1  | MIT OR Apache-2.0         | https://github.com/gfx-rs/wgpu                  | the HLOD atlases baked on the GPU (Metal, Vulkan, Direct3D 12, GL), with its crates `wgpu-core`, `wgpu-hal`, `wgpu-types` and `naga` |
| `pollster`          | 1.0.1   | MIT OR Apache-2.0         | https://github.com/zesterer/pollster            | blocking on the GPU adapter and device requests                                                                                      |
| `bytemuck`          | 1.25.2  | Zlib OR Apache-2.0 OR MIT | https://github.com/Lokathor/bytemuck            | the GPU bake's words viewed as bytes, no copy                                                                                        |

`block_compression` is a Rust port of Intel's ISPC Texture Compressor. It is carried in
`packages/asset-compiler-rust/vendor/block_compression` as published (git
454e069802a600b8e225fb2c9dca3049630b8523), with one change marked in
`src/encode/common.rs:compute_axis`: its principal-axis search starts from the covariance row of the
largest diagonal entry instead of grey. Its licence, kept in the vendored folder:

```
Copyright (c) 2025, Nils Hasenbanck
Copyright (c) 2016-2024, Intel Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

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
wgpu: Copyright (c) 2025 The gfx-rs developers
pollster: Copyright (c) 2020-2021 Joshua Barretto
bytemuck: Copyright (c) 2019 Daniel "Lokathor" Gee.

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

## Float-to-sRGB8 table (stb_image_resize)

- What it is: the 104-entry table, and the interpolation over it, that turn a linear `f32` colour
  channel into the byte of its sRGB encoding — Fabian Giesen's "float->sRGB8 conversions"
  (https://gist.github.com/rygorous/2203834, placed in the public domain by its author), as
  published in `stb_image_resize.h` (https://github.com/nothings/stb).
- Shipped in: the native asset compiler, `packages/asset-compiler-rust/src/dag/input/colour.rs`,
  where a vertex colour enters the cluster DAG.
- Licence: stb's, either alternative; the MIT alternative applies here. The licence text of
  `stb_image_resize.h`, as published upstream:

```text
------------------------------------------------------------------------------
This software is available under 2 licenses -- choose whichever you prefer.
------------------------------------------------------------------------------
ALTERNATIVE A - MIT License
Copyright (c) 2017 Sean Barrett
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
------------------------------------------------------------------------------
```

## MikkTSpace (tangent spaces)

- Source: Morten S. Mikkelsen's MikkTSpace tangent space generator, version 1.0
  (`mikktspace.c`, `mikktspace.h`; https://github.com/mmikk/MikkTSpace).
- Shipped as: an altered version — a port to Rust, for meshes of triangles, of its weld, its
  per-triangle derivatives, its neighbours, its groups, its tangent spaces and its degenerate
  triangles' spaces — inside the native asset compiler,
  `packages/asset-compiler-rust/src/dag/input/mikk.rs` and `mikk/`, where a mesh's stored tangents
  are rebuilt before its cluster DAG. This is not the original software.
- Licence: zlib. The licence text, as published upstream:

```text
Copyright (C) 2011 by Morten S. Mikkelsen

This software is provided 'as-is', without any express or implied
warranty.  In no event will the authors be held liable for any damages
arising from the use of this software.

Permission is granted to anyone to use this software for any purpose,
including commercial applications, and to alter it and redistribute it
freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not
   claim that you wrote the original software. If you use this software
   in a product, an acknowledgment in the product documentation would be
   appreciated but is not required.
2. Altered source versions must be plainly marked as such, and must not be
   misrepresented as being the original software.
3. This notice may not be removed or altered from any source distribution.
```

## OpenVDB (simplified HLOD layers' volume)

- Source: https://github.com/AcademySoftwareFoundation/openvdb, version 13.0.0.
- Shipped as: a port to Rust, inside the native asset compiler, of its sparse tree, its conversion
  of a mesh to a narrow-band level set (with the grid of each voxel's closest polygon), its
  level-set pruning and union and its conversion of a level set to a mesh, in
  `packages/asset-compiler-rust/src/hlod/flatten/simplify/volume.rs` and `volume/**`; the point
  of a triangle closest to a point is written from its documentation (Ericson, Real-Time Collision
  Detection), the library shipping it only as a binary.
- Licence: Apache-2.0; see https://www.apache.org/licenses/LICENSE-2.0.

```text
Copyright Contributors to the OpenVDB Project
SPDX-License-Identifier: Apache-2.0
```

## DirectXMesh (simplified HLOD layers' chart cleaning)

- Source: https://github.com/microsoft/DirectXMesh.
- Shipped as: a port to Rust, inside the native asset compiler, of its face adjacency (point
  representatives at an exact position, their conversion to adjacency) and its mesh cleaning
  (asymmetric and duplicate links, bowties broken), in
  `packages/asset-compiler-rust/src/hlod/flatten/simplify/adjacency.rs` and `clean.rs`; and its
  tangent frame (per-vertex tangent and bitangent from the normals and texture coordinates), in
  `packages/asset-compiler-rust/src/hlod/flatten/simplify/tangents.rs`.
- Licence: MIT.

```text
The MIT License (MIT)

Copyright (c) 2017 Microsoft Corp

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## FLIP (image difference metric, bench only)

- What it is: LDR-FLIP, the perceptual image difference metric of Andersson et al., "FLIP: A
  Difference Evaluator for Alternating Images" (NVIDIA, HPG 2020).
- Source: https://github.com/NVlabs/flip (official repository; reference tool `flip-evaluator` 1.7).
- Used by: `bench/runner/references/flip.ts`, a measurement tool. It is not shipped: the `files` of
  `package.json` lists only `dist` (without `dist/witnesses`), a few documents and
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

Models and textures are not code and are listed apart. In git: the 200-triangle extract of A
Beautiful Game (© 2020 ASWF, © 2022 Ed Mackey, CC BY 4.0; `tests/fixtures/physics/`) and the Draco
Box (© 2017 Cesium, CC BY 4.0; `tests/fixtures/formats/gltf/compressed-box/`). The bench's public
models (`bench/runner/assets/assetsCatalogue.ts`: Sponza, DamagedHelmet, Duck, CesiumMan,
AnimatedMorphCube and the others) are downloaded outside git under the terms each one's own
`README.md` carries, and are not redistributed by this repository.
