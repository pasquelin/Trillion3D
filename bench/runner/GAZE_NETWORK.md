# Gaze-driven texture network reading

Run the benchmark's camera-session mode on an existing compiled test scene:

```sh
TRILLION3D_ASSETS=/path/to/this-repository/.mesure/assets \
  node bench/runner/bench.ts --engine webgpu --textures cache --gaze-network \
  --scene sponza --views overview,ground --images 60 --pixelError 1 \
  --out .mesure/out/41-gaze-network
```

`TRILLION3D_ASSETS` is needed only from a worktree whose `.mesure/assets/` is empty: point it at
this repository's existing assets. The mode takes the usual before and after sides and writes
`gazeNetwork` readings to `measure.json` and a table to `resume.md`.

Each reading opens a fresh browser, plays the chosen trajectory at one pose per animation frame,
then lets requests already issued finish for up to ten seconds. It does not call `awaitPages`,
`flush`, or the still-image convergence barrier. Chrome's `Network.loadingFinished` encoded data
length counts actual transfer bytes, including response overhead; a response served from browser
cache counts as zero. `textureBytes` covers baked files under `/textures/`; `otherBytes` covers
manifest, geometry, modules, and other traffic. Failed and unfinished requests, plus redirects
whose transfer size Chrome did not report, are reported separately. Any nonzero count marks the
byte reading incomplete; do not use it as a bandwidth verdict.

Network transfer only: frame time and fidelity come from the ordinary benchmark and image proof.
