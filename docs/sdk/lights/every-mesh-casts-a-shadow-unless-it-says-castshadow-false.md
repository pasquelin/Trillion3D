# Every mesh casts a shadow unless it says `castShadow = false`

Under a casting light (the light's `castShadow: true`, `false` by default), every opaque mesh
casts (a mesh's `castShadow` defaults to `true`). `mesh.castShadow = false`, written any time,
leaves every shadow map; the mesh still receives shadows. An outline drawn as a larger copy of its
part wants it off, or it shades the part.
