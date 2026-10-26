//! A merged layer's settings beyond its LOD selection and whether it merges its materials: the
//! screen size its sources' LOD is taken at, whether equivalent materials collapse, whether its
//! mesh keeps its sources' vertex colours, and how a layer merging its materials flattens them —
//! its atlas's side and sizing, each cell's gutter, whether the cells are binned, whether an entry
//! bakes on its mesh and on which texture coordinates, whether the flattened material may draw
//! both faces, and its maps (`flatten/merge/flat.rs`). Each read, checked against its range and
//! defaulted (`HlodMerging::default`). The layer's JSON is the cache's identity (`Hlod::named`): a
//! setting named changes the key, one left out keeps it.
use super::approximation::{atlas_sizing, HlodAtlasSizing, MERGE_SIZING};
use super::fields::{chosen_of, counted, maps_with, named, set, switch};
use super::*;
use crate::compiler::validate::{Fields, OPTIONS};
use crate::hlod::flatten::bake::Maps;

/// How a layer sizes its atlas with one side for every map, over its merged, simplified or
/// approximated mesh (`textureSizing`, `HLOD_TEXTURE_SIZINGS` order).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum HlodTextureSizing {
    /// The layer's `textureSize` (`'fixed'`, the default).
    Fixed,
    /// The side whose texels a metre over the merged mesh come nearest `texelsPerMetre`
    /// (`'texelDensity'`).
    TexelDensity(f64),
    /// The side whose texels a metre come nearest those the merged mesh's bounding sphere spans
    /// when it fills `atlasScreenSize` of the view (`'screenSize'`).
    ScreenSize(f64),
    /// The side whose texels a metre come nearest those the merged mesh's bounding sphere spans
    /// where its actor is first drawn (`'drawDistance'`).
    DrawDistance,
}

/// The words `textureSizing` takes, in `HlodTextureSizing`'s order.
pub const HLOD_TEXTURE_SIZINGS: [&str; 4] = ["fixed", "texelDensity", "screenSize", "drawDistance"];

/// The method each word of `HLOD_MERGE_UV_METHODS` names, in its order: `default`, the patches
/// unwrap, what the generator names its default; `xAtlas`, the charts unwrap
/// (`approximation.uvMethod: 'charts'`); `patchBuilder`, the patches unwrap; `legacy`, the old
/// chart layout of the mesh's own first texture set, the patches unwrap where it finds no layout;
/// `uvAtlas`, the spectral charts.
const MERGE_UV_METHODS: [HlodUvMethod; 5] = [
    HlodUvMethod::Patches,
    HlodUvMethod::Charts,
    HlodUvMethod::Patches,
    HlodUvMethod::Legacy,
    HlodUvMethod::UvAtlas,
];

// A word the contract adds without a method here would index past `MERGE_UV_METHODS` (`chosen_of`).
const _: () = assert!(HLOD_MERGE_UV_METHODS.len() == MERGE_UV_METHODS.len());

/// A merged layer's settings, each the layer's own or its default:
/// - `lod_screen_size`: the share of the view a source's bounding sphere spans when the LOD
///   `lodSelection: 'calculate'` takes is drawn (`lodScreenSize`, 0.25, above 0 to 1);
/// - `collapse`: whether equivalent materials collapse into the first of them
///   (`collapseEquivalentMaterials`, true);
/// - `keep_colours`: whether a merged mesh keeping its materials keeps its sources' vertex
///   colours, a source with none white (`bakeVertexColors`, false);
/// - `sizing`: how its atlas is sized (`textureSizing`, fixed; `texelsPerMetre` 5, from 0.1 to
///   1024; `atlasScreenSize` 0.5, from 0.01 to 1; `mapSizes`);
/// - `gutter`: each cell's gutter, texels (`atlasGutter`, 2, up to 64);
/// - `binned`: whether the cells are squares sized by their materials' largest textures, not a
///   grid (`binByTextureSize`, false);
/// - `on_mesh`: whether an entry whose look its mesh decides bakes on that mesh, not on a quad
///   (`bakeOnMesh`, true);
/// - `reuse_lightmap_uvs`: whether such an entry bakes on its mesh's texture set at its lightmap
///   index where it has one, its unique coordinates, else on generated ones (`reuseLightmapUVs`,
///   true); false lays every mesh out together, once, and bakes every entry on its mesh into the
///   one atlas, no cell, gutter or binning (`flatten/merge/flat/global.rs`);
/// - `uv_method`: how those are generated (`uvMethod`, `default`, the patches unwrap, `legacy`, the
///   old chart layout, and `uvAtlas`, the spectral charts, among its words);
/// - `double_sided`: whether the flattened material may draw both faces (`allowDoubleSided`,
///   true);
/// - `maps`: the images baked beside the base colour (`maps`, the normal map alone).
#[derive(Clone, Copy, Debug)]
pub struct HlodMerging {
    pub lod_screen_size: f64,
    pub collapse: bool,
    pub keep_colours: bool,
    pub sizing: HlodAtlasSizing,
    pub gutter: usize,
    pub binned: bool,
    pub on_mesh: bool,
    pub reuse_lightmap_uvs: bool,
    pub uv_method: HlodUvMethod,
    pub double_sided: bool,
    pub(crate) maps: Maps,
}

impl Default for HlodMerging {
    fn default() -> Self {
        Self {
            lod_screen_size: 0.25,
            collapse: true,
            keep_colours: false,
            sizing: HlodAtlasSizing::default(),
            gutter: 2,
            binned: false,
            on_mesh: true,
            reuse_lightmap_uvs: true,
            uv_method: HlodUvMethod::Patches,
            double_sided: true,
            maps: Maps::default(),
        }
    }
}

/// The fields a merged layer's `maps` admits: the images baked beside the base colour.
const MAP_FIELDS: [&str; 10] = [
    "normal",
    "roughness",
    "metallic",
    "specular",
    "emissive",
    "opacity",
    "opacityMask",
    "ambientOcclusion",
    "anisotropy",
    "tangent",
];

/// The generation method of merged layer `map` (`what` naming it): the one a word of
/// `HLOD_MERGE_UV_METHODS` names (`MERGE_UV_METHODS`), `default` when absent.
fn uv_method(map: &Map<String, Value>, what: &str) -> Result<HlodUvMethod> {
    let words = (&HLOD_MERGE_UV_METHODS[..], &MERGE_UV_METHODS[..]);
    Ok(chosen_of(map, "uvMethod", what, words)?.unwrap_or(HlodUvMethod::Patches))
}

/// The merged layer settings of `map` (`what` naming the layer): the screen size and the collapse
/// of equivalent materials; `bakeVertexColors` where it keeps its materials, refused otherwise —
/// the atlas of a layer merging them already holds its sources' vertex colours —; and — only with
/// `mergeMaterials`, refused otherwise — the atlas's sizing with the one setting its sizing reads,
/// the gutter, the binning, the bake on meshes and the coordinates it is baked at, both faces and
/// the maps, no more than one of the opacity and the mask, the base image's alpha holding either;
/// every other left out defaulted.
pub(super) fn merging(map: &Map<String, Value>, what: &str, flattens: bool) -> Result<HlodMerging> {
    let mut read = HlodMerging::default();
    // A positive share of the view, the whole of it at most.
    let key = "lodScreenSize";
    if let Some(v) = OPTIONS.optional(map.get(key), &format!("{what}.{key}"), Fields::number)? {
        if !(v > 0.0 && v <= 1.0) {
            return Err(OPTIONS.bad(format!("{what}.{key} must be above 0, 1 at most")));
        }
        read.lod_screen_size = v;
    }
    set(
        &mut read.collapse,
        switch(map, "collapseEquivalentMaterials", what)?,
    );
    const FLATTENING: [&str; 13] = [
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
        "textureSize",
    ];
    if !flattens {
        if let Some(key) = FLATTENING.iter().find(|&&key| named(map, key)) {
            return Err(OPTIONS.bad(format!("{what}: {key} needs mergeMaterials")));
        }
        set(
            &mut read.keep_colours,
            switch(map, "bakeVertexColors", what)?,
        );
        return Ok(read);
    }
    if named(map, "bakeVertexColors") {
        return Err(OPTIONS.bad(format!(
            "{what}: bakeVertexColors keeps the vertex colours on a merged mesh that keeps its \
             materials: the atlas of a layer merging them already holds them"
        )));
    }
    atlas_settings(&mut read, map, what)?;
    Ok(read)
}

/// The settings of the atlas of a merged layer that merges its materials, read from `map` into
/// `read`: the sizing with the one setting it reads, the gutter, the binning, the bake on meshes
/// and the coordinates it is baked at, both faces and the maps. A layer that does not reuse its
/// meshes' lightmap sets (`reuseLightmapUVs` false) lays them out together: it has no cell, so no
/// gutter and no binning, and bakes every entry on its mesh, whatever `bakeOnMesh` says.
fn atlas_settings(read: &mut HlodMerging, map: &Map<String, Value>, what: &str) -> Result<()> {
    read.sizing = atlas_sizing(map, what, MERGE_SIZING)?;
    set(
        &mut read.gutter,
        counted(map, "atlasGutter", what, (0, 64))?,
    );
    set(&mut read.binned, switch(map, "binByTextureSize", what)?);
    set(&mut read.on_mesh, switch(map, "bakeOnMesh", what)?);
    set(
        &mut read.reuse_lightmap_uvs,
        switch(map, "reuseLightmapUVs", what)?,
    );
    read.uv_method = uv_method(map, what)?;
    set(
        &mut read.double_sided,
        switch(map, "allowDoubleSided", what)?,
    );
    read.maps = maps_with(map.get("maps"), what, read.maps, &MAP_FIELDS)?;
    Ok(())
}
