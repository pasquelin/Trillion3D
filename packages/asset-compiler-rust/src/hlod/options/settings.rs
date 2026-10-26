//! The settings each builder of a layer reads, by name (`HlodBuilder::settings`): a name a layer
//! holds that its builder does not list is refused.

/// An `instanced` layer's settings.
pub(super) const INSTANCED: &[&str] = &[
    "sizeFilter",
    "minExtent",
    "minArea",
    "minVolume",
    "disallowClusterDag",
];

/// An `approximate` layer's settings.
pub(super) const APPROXIMATE: &[&str] = &[
    "accuracy",
    "deviation",
    "textureSize",
    "textureSizing",
    "texelsPerMetre",
    "atlasScreenSize",
    "mapSizes",
    "approximation",
    "clusterDag",
    "translucency",
    "emptyTexels",
    "allowDistanceField",
];

/// A `merge` layer's settings.
pub(super) const MERGE: &[&str] = &[
    "lodSelection",
    "lodScreenSize",
    "collapseEquivalentMaterials",
    "mergeMaterials",
    "bakeVertexColors",
    "textureSize",
    "textureSizing",
    "texelsPerMetre",
    "atlasScreenSize",
    "mapSizes",
    "atlasGutter",
    "binByTextureSize",
    "bakeOnMesh",
    "reuseLightmapUVs",
    "uvMethod",
    "allowDoubleSided",
    "maps",
    "translucency",
    "clusterDag",
    "meshBuild",
    "allowDistanceField",
];

/// A `simplify` layer's settings.
pub(super) const SIMPLIFY: &[&str] = &[
    "simplification",
    "textureSize",
    "textureSizing",
    "texelsPerMetre",
    "atlasScreenSize",
    "mapSizes",
    "atlasGutter",
    "allowDoubleSided",
    "maps",
    "reuseLightmapUVs",
    "groupIdenticalMeshes",
    "allowVertexColors",
    "translucency",
    "emptyTexels",
    "clusterDag",
    "meshBuild",
    "allowDistanceField",
];
