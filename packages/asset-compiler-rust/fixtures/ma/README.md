# Correction fixture — `ma` driver (Maya ASCII)

One fixture, one question: **what the driver produces from a MEL command file, and what it
refuses to do with it**. The golden is [`../../src/tests/ma_golden.rs`](../../src/tests/ma_golden.rs); the
behaviours that only the inside of the driver proves — text splitting, writing an attribute in
slices, resolving a corner from its edge — are in
[`../../src/plugins/scene/ma/tests.rs`](../../src/plugins/scene/ma/tests.rs).

| file                             | what it pins                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minuscule/scene.ma`             | the scene: `transform` hierarchy, `mesh` of two quadrilaterals, two shaded face groups, instance via `parent -add`, `lambert` and `standardSurface` of which one is textured |
| `minuscule/textures/checker.png` | the texture the `standardSurface` cites, resolved relative to the source folder                                                                                              |

What each choice puts under watch:

- **a face that reuses another face's edge in reverse** (`f 4 -3 4 5 6`): a Maya face cites its
  **edges**, and the corner of rank `k` is the start vertex of the `k`-th — the second vertex when
  the index is written negative. That is the easiest rule in the whole format to read the wrong way;
- **two quadrilaterals**: fan triangulation, four triangles for two faces;
- **two `objectGrpCompList` of one face each**: one `instObjGroups` per face group becomes
  a separate glTF primitive, and no face is drawn twice;
- **no written normal**: they are computed flat, one per face, and the report says so;
- **`currentUnit -l centimeter`**: the `0.01` factor toward the metre, carried by the scene root,
  and not applied to the vertices;
- **a 90° rotation with `rotateOrder`**: the local matrix, composed in the declared order;
- **`parent -add -s`**: a second pose of the same shape cites the **same** glTF mesh;
- **an opaque `lambert` and a `standardSurface` with `opacity` 0.5, metal, colour texture and
  emission**: `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `alphaMode` and the texture
  slot, without any rule naming an object type;
- **a camera, a `select` on a node absent from the file, and a `python` command**: what the
  driver **counts without rendering**. The `python` command is the written proof of the safety contract:
  its text enters the report under `ma-command-ignored:python`, and nothing executes it.

## Provenance and licences

- `minuscule/scene.ma`: written by hand for this test from Autodesk's public MEL command
  documentation, with no content, code or SDK from a third party.
- `minuscule/textures/checker.png`: copied from the WebGeometry corpus, **CC0-1.0**, see
  [LICENSE.txt](LICENSE.txt).

## `expected.json`

The selected driver, the intermediate scene it wrote — nodes, meshes, materials, images,
samplers, textures, accessors, report — and the compiled scene that comes out of it, sidecar included.
The cache key does not appear in it: a converted scene's manifest carries its import duration, so the
key changes from one run to the next without the scene moving. `case` and `rule` are prose only,
the test strips them before comparing. To regenerate it:

```sh
cargo test --lib regenere_la_fixture_ma -- --ignored
```
