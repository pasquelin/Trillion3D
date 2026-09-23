# Correction fixture — `usdz` driver, container

A container must change nothing about the scene it wraps. The package carries the **same layer** as
[`../usd/corpus/usdc/scene.usdc`](../usd/corpus/usdc/scene.usdc), and the golden
([`../../../../packages/asset-compiler-rust/src/tests/formats/usd/usdz_golden.rs`](../../../../packages/asset-compiler-rust/src/tests/formats/usd/usdz_golden.rs)) compiles both, compares the
second against the first, then compares the first against `expected.json`.

| file                | what it pins                                                                    |
| ------------------- | ------------------------------------------------------------------------------- |
| `scene.usdz`        | the conforming package: entries stored as-is, payloads aligned on 64 bytes, one `usdc` layer and its texture in a subfolder |
| `compressee.usdz`   | a `deflate` entry: rejection `USDZ_LAYOUT_INVALID`, nothing is extracted        |
| `sans-scene.usdz`   | a package that does not open on a USD layer: rejection `USDZ_ROOT_LAYER_MISSING` |
| `deux-scenes.usdz`  | two layers: a triangle first, a quadrilateral next. The package delivers the first, and the triangle count says so |

What each choice puts under watch:

- **the package layout**: the AOUSD specification requires stored, aligned entries,
  so the layer and its images can be read in place. A package that is not is refused by
  saying so, rather than read anyway;
- **a texture in a subfolder**: the package's relative URIs are not rewritten, the container
  flattens nothing, and the root where images resolve is the extracted folder;
- **the root-layer choice**: neither guessed nor searched among the entries. The AOUSD
  specification wants the **first** entry of the package to be the root layer; everything that follows it is
  a resource, never a candidate scene. A package that does not open on a USD layer therefore does not
  say which scene it delivers, and it is refused under its own name.

## Provenance and licences

- `scene.usdz`: WebGeometry corpus (`test/assets/usd/procedural-usdz`), **CC0-1.0**, see
  [LICENSE.txt](LICENSE.txt). `test/assets/` is not tracked by git: these bytes are copied here
  so the golden holds without it.
- `compressee.usdz`, `sans-scene.usdz` and `deux-scenes.usdz`: synthetic, written for this test,
  with no third-party content. They come from a tool outside the crate the driver uses
  to read — a trap package must come from somewhere other than the reader it puts on trial. To
  regenerate them from this folder:

  ```sh
  python3 - <<'PY'
  import struct, zipfile
  LAYER = b'#usda 1.0\n(\n    defaultPrim = "Root"\n)\n\ndef Xform "Root"\n{\n}\n'
  def aligned(archive, name, data):
      offset = archive.fp.tell()
      need = (64 - (offset + 30 + len(name.encode())) % 64) % 64
      if 0 < need < 4:
          need += 64
      entry = zipfile.ZipInfo(name)
      entry.compress_type = zipfile.ZIP_STORED
      entry.extra = b"" if need == 0 else struct.pack("<HH", 0x1986, need - 4) + b"\0" * (need - 4)
      archive.writestr(entry, data)
  with zipfile.ZipFile("compressee.usdz", "w") as a:
      e = zipfile.ZipInfo("scene.usda"); e.compress_type = zipfile.ZIP_DEFLATED
      a.writestr(e, LAYER * 40)
  with zipfile.ZipFile("sans-scene.usdz", "w") as a:
      aligned(a, "textures/checker.png", b"\x89PNG\r\n\x1a\n")
  def mesh(name, counts, indices, points):
      return ('#usda 1.0\n(\n    defaultPrim = "Root"\n)\n\ndef Xform "Root"\n{\n'
              f'    def Mesh "{name}"\n    {{\n'
              f'        int[] faceVertexCounts = [{counts}]\n'
              f'        int[] faceVertexIndices = [{indices}]\n'
              f'        point3f[] points = [{points}]\n'
              '    }\n}\n').encode()
  with zipfile.ZipFile("deux-scenes.usdz", "w") as a:
      aligned(a, "premiere.usda", mesh("Triangle", "3", "0, 1, 2", "(0, 0, 0), (1, 0, 0), (0, 1, 0)"))
      aligned(a, "seconde.usda", mesh("Quad", "4", "0, 1, 2, 3", "(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)"))
  PY
  ```

## `expected.json`

The selected driver, the `usdz` → `usd` chain published in the report, the two rejection codes, the
triangle count of the two-layer package, and the scene
— format version, binary sidecar version, sha256 of `clusters.bin`, primitive, node
and triangle counts. The cache key does not appear in it: it holds the fingerprint of the whole
compiler implementation, so an unrelated change would move it; equality with the
bare layer is the real subject, and it is checked on the intermediate scene and the sidecar. `case` and
`rule` are prose only, the test strips them before comparing. To regenerate it:

```sh
cargo test --lib regenere_la_fixture_usdz -- --ignored
```
