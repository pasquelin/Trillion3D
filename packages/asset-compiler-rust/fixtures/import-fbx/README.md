# FBX import fixture — classic-material opacity

`riviere.fbx` is a 3 KB **ASCII** FBX 7400 written by hand: a quad, a `phong` material `M_Riviere`,
two textures. It reproduces as short as possible the exact shape opacity takes in
`Village2.fbx` (Whisperwind Village, 409 MB, off repository):

- `ShadingModel: "phong"` — so `ufbx` classifies the material as `FbxPhong`, `features.pbr` stays
  off and **`pbr.opacity` has neither a value nor a texture**;
- `TransparentColor` carries the transparency *and* the opacity map (`C: "OP",5000,3000,
  "TransparentColor"`), `TransparencyFactor` the factor.

The two images (`albedo.png`, `opacite.png`) are not versioned: the test writes them beside the
throwaway copy of the FBX, like the OBJ fixtures. The only thing that counts here is the path
opacity takes, not the pixel contents.

To wire the same texture onto base colour and opacity, the test replaces the last
connection with `C: "OP",4000,3000, "TransparentColor"`; that is the case where glTF can carry the alpha
in `baseColorTexture`.
