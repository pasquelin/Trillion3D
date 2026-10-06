# Gaze-driven texture network reading

`bench.ts --gaze-network` counts the bytes Chrome transfers while the camera moves, instead of
timing:

```sh
node bench/runner/bench.ts --engine webgpu --textures cache --gaze-network \
  --scene sponza --views overview,ground --images 60 --pixelError 1 --out .mesure/out/gaze-network
```

It needs a compiled cache scene, `--textures cache` and the WebGPU page engine on every side, and
does not run with `--reference`. From a worktree whose `.mesure/assets/` is empty, set
`TRILLION3D_ASSETS` to the main checkout's. The readings go to `gazeNetwork` in `measure.json` and
a "Gaze-driven network transfer" table in `resume.md`.

Each reading opens a fresh browser, plays the trajectory at one pose per animation frame, then lets
requests already issued finish for up to ten seconds; no `awaitPages`, `flush` or convergence
barrier. Chrome's `Network.loadingFinished` encoded data length counts actual transfer bytes,
response overhead included; a response served from browser cache counts zero. `textureBytes` covers
baked files under `/textures/`; `otherBytes` the manifest, geometry, modules and the rest. Failed
and unfinished requests, and redirects whose size Chrome did not report, are counted apart: any
nonzero count marks the reading incomplete, never a bandwidth verdict. Frame time and fidelity come
from the other benches.
