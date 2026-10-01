# 3MF Core fixture

CC0, authored from the public 3MF Core 2015/02 specification. `scene.model` is the readable source of `scene.3mf`; the deterministic ZIP adds OPC content types and the root model relationship. A centimetre/Z-up model contains two instances of one triangle, a component transform, and two distinct equal-valued base materials.

Supported: Core triangle meshes, components/build instances, units/transforms, base materials, and material-extension per-corner colour groups. Unsupported textures/composite materials and required extensions are explicit refusals. Package paths, duplicate entries, XML entities, resource references, cycles and decompressed admission limits are checked before emission.
