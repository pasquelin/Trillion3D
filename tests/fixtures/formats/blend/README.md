# Blender fixtures

## `procedural-materials`

Original Blender scene **CC0-1.0**, taken as-is from the local corpus
`test/assets/blend/procedural-materials` (WebGeometry corpus, procedural generation, 15 September
2026, written by Blender 5.2.1 LTS). The repository ignores `test/assets/`: the file the driver
needs is copied here with its notice, `LICENSE.txt`. No file is produced by the repository and
no Blender install is required to replay the golden.

`scene.blend` (92,065 bytes, Zstandard-compressed as Blender does by default) carries:

- an empty object `HierarchyRoot` — counted and not rendered — and **three mesh objects**
  `SharedMesh_0`, `SharedMesh_1` and `SharedMesh_2`, parented to it, placed at (0, 0, 0), (3, 0, 0)
  and (6, 0, 0): the world matrix is therefore composed through the parent chain, the parenting
  matrix and the local transform, no matrix being written in a file of this generation;
- **a single mesh** `Cube` for the three objects — eight vertices, six four-corner faces,
  twenty-four corners —, which makes these objects instances: the glTF writes the mesh
  only once;
- **per-face material indices** (0, 1, 2, 0, 1, 2), hence three primitives in the mesh;
- one **UV** layer per corner, named `UVMap`, and a single `sharp_face` at true: every face
  is sharp, so the normals are computed flat;
- **three materials** with a `Principled BSDF` node: `Emissive` (emission colour of intensity 3, therefore
  clamped by glTF and counted), `Opaque` (base colour wired to an image) and
  `Transparent` (base colour and alpha wired to the same image);
- **one PNG image packed** in the file (`checker_rgba.png`, 291 bytes), whose declared path
  leaves the served tree: it is the packed bytes that are used, poured as-is
  into the intermediate scene binary through a buffer view.

The golden's expected is in `procedural-materials/expected.json`.

## `limites`

`truncated.blend`: the first 4,096 bytes of the same file once unwrapped — a valid header
followed by a block that is not whole. The driver must refuse it as `blend-truncated`, without panic
or unbounded allocation. Same CC0-1.0 licence, notice in `LICENSE.txt`.

## What the repository does not own

No file written by a Blender older than the named-attribute layout, nor by a
32-bit Blender or on a big-endian machine. The matching rejections are therefore proved on
a minimal file written in the test from the format description
(`src/plugins/scene/blend/tests.rs`), never on a committed fixture.
