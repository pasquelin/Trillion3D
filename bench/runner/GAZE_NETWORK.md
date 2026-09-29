# Gaze-driven texture network reading

Run the benchmark's camera-session mode on an existing compiled test scene:

```sh
TRILLION3D_ASSETS=/path/to/this-repository/.mesure/assets \
  node bench/runner/bench.ts --engine webgpu --textures cache --gaze-network \
  --scene sponza --views overview,ground --images 60 --pixelError 1 \
  --out .mesure/out/41-gaze-network
```

The `TRILLION3D_ASSETS` setting is only needed when running from a separate worktree whose
`.mesure/assets/` directory has not been populated. Use the existing assets of this repository.
The mode accepts the usual before and after sides for a branch comparison and writes
`gazeNetwork` readings to `measure.json` and a table to `resume.md`.

Each reading opens a fresh browser, plays the chosen trajectory at one pose per animation frame,
then lets requests already issued finish for up to ten seconds. It does not call `awaitPages`,
`flush`, or the still-image convergence barrier. Chrome's `Network.loadingFinished` encoded data
length counts actual transfer bytes, including response overhead; a response served from browser
cache counts as zero. `textureBytes` covers baked files under `/textures/`; `otherBytes` covers
manifest, geometry, modules, and other traffic. Failed and unfinished requests, plus redirects
whose transfer size Chrome did not report, are reported separately. Any nonzero count marks the
byte reading incomplete; do not use it as a bandwidth verdict.

This mode reports network transfer only. Run the ordinary benchmark and image proof separately
for frame time and fidelity.
