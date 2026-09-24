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
