//! A simplified layer's settings (`simplify` builder): the voxel the cell's sources are sampled on,
//! the gaps closed, the normals, the transfer of their materials and the atlas the transfer fills
//! — every setting the method lets a host turn, each read, checked against its range and defaulted
//! to the value the method is defined with (`HlodSimplifying::default`). The method's own
//! settings sit in the layer's `simplification` object; its atlas's — `textureSizing` and the
//! setting its sizing reads (`mapSizes` too), `atlasGutter`, `maps`, `allowDoubleSided` — and the
//! proxy's own — `groupIdenticalMeshes`, `allowVertexColors`, `reuseLightmapUVs` — on the layer,
//! as a merged layer names them. The layer's JSON is the cache's identity (`Hlod::named`): a
//! setting named changes the key, one left out keeps it.
use super::approximation::{atlas_sizing, HlodAtlasSizing, SIMPLIFY_SIZING};
use super::fields::{chosen_of, counted, maps_of, ranged, set, switch};
use super::*;
use crate::compiler::validate::OPTIONS;
use crate::hlod::flatten::bake::Maps;

/// How the vertex normals of the simplified mesh weigh the faces around a vertex (`normalMethod`,
/// `HLOD_NORMAL_METHODS` order).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodNormalMethod {
    /// Each face by the angle it makes at the vertex (`'angleWeighted'`, the default).
    AngleWeighted,
    /// Each face by its area (`'areaWeighted'`).
    AreaWeighted,
    /// Each face alike (`'equalWeighted'`).
    EqualWeighted,
}

impl HlodNormalMethod {
    /// Every method, in `HLOD_NORMAL_METHODS` order.
    const ALL: [Self; 3] = [Self::AngleWeighted, Self::AreaWeighted, Self::EqualWeighted];
}

/// How the rays that pair an atlas texel with a point of the sources pick their hit
/// (`transferRays`, `HLOD_TRANSFER_RAYS` order).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodTransferRays {
    /// Both rays, along the normal and against it, the nearer hit kept (`'nearest'`, the default).
    Nearest,
    /// Both rays, a hit whose source faces the ray's way preferred, the nearer of two such
    /// (`'facing'`).
    Facing,
}

impl HlodTransferRays {
    /// Every choice, in `HLOD_TRANSFER_RAYS` order.
    const ALL: [Self; 2] = [Self::Nearest, Self::Facing];
}

/// A simplified layer's settings, each the layer's own or its default:
/// - `voxel`: the voxel the sources are sampled on, metres (`voxel`), none to derive it from
///   the screen size the cell's actor is first drawn at;
/// - `gap_width`: the widest gap closed between the sources, metres (`gapWidth`, 0);
/// - `unresolved`: the base colour, sRGB bytes, of a texel the transfer finds no source for
///   (`unresolvedColor`, black);
/// - `transfer_distance`: how far, metres, a transfer ray looks for the sources
///   (`transferDistance`), none for six voxels;
/// - `hard_angle`: the angle, degrees, past which two faces split their vertices
///   (`hardAngle`: a number, `true` 130, `false` none — the default);
/// - `normal_method`: how vertex normals weigh their faces (`normalMethod`, angle-weighted);
/// - `gap_steps`: the most dilation and erosion steps of the gap closing, 0 for none
///   (`gapSteps`, 7);
/// - `rays`: how a transfer ray picks its hit (`transferRays`, the nearer);
/// - `folded_walls`: whether the walls the simplification folded into each other are pushed
///   apart (`separateFoldedWalls`, false);
/// - `serial`: whether the simplification runs as one pass over the whole mesh rather than over
///   partitions of it first (`serialSimplify`, false);
/// - `sizing`: how its atlas is sized (`textureSizing`, fixed; the layer's `textureSize`, the
///   settings its sizing reads, `mapSizes`);
/// - `gutter`: the texels kept between two charts of its atlas (`atlasGutter`, 4, up to 64);
/// - `double_sided`: whether the flattened material may draw both faces when a source does
///   (`allowDoubleSided`, true);
/// - `maps`: the images baked beside the base colour (`maps`, the normal map alone);
/// - `empty_texels`: what the atlas holds where no chart reaches (`emptyTexels`, the nearest
///   chart's);
/// - `group_identical`: whether the objects placing one mesh are baked once, from the first of
///   them (`groupIdenticalMeshes`, false);
/// - `vertex_colours`: whether the simplified mesh carries the sources' vertex colours
///   (`allowVertexColors`, false: white, none stored);
/// - `reuse_lightmap_uvs`: whether an object bakes on the texture set its meshes have at their
///   lightmap index where they have one (`reuseLightmapUVs`, true).
#[derive(Clone, Copy, Debug)]
pub struct HlodSimplifying {
    pub voxel: Option<f64>,
    pub gap_width: f64,
    pub unresolved: [u8; 3],
    pub transfer_distance: Option<f64>,
    pub hard_angle: Option<f64>,
    pub normal_method: HlodNormalMethod,
    pub gap_steps: usize,
    pub rays: HlodTransferRays,
    pub folded_walls: bool,
    pub serial: bool,
    pub sizing: HlodAtlasSizing,
    pub gutter: usize,
    pub double_sided: bool,
    pub(crate) maps: Maps,
    pub empty_texels: HlodEmptyTexels,
    pub group_identical: bool,
    pub vertex_colours: bool,
    pub reuse_lightmap_uvs: bool,
}

impl Default for HlodSimplifying {
    fn default() -> Self {
        Self {
            voxel: None,
            gap_width: 0.0,
            unresolved: [0, 0, 0],
            transfer_distance: None,
            hard_angle: None,
            normal_method: HlodNormalMethod::AngleWeighted,
            gap_steps: 7,
            rays: HlodTransferRays::Nearest,
            folded_walls: false,
            serial: false,
            sizing: HlodAtlasSizing::default(),
            gutter: 4,
            double_sided: true,
            maps: Maps::default(),
            empty_texels: HlodEmptyTexels::default(),
            group_identical: false,
            vertex_colours: false,
            reuse_lightmap_uvs: true,
        }
    }
}

/// The fields `simplification` admits.
const FIELDS: [&str; 10] = [
    "voxel",
    "gapWidth",
    "unresolvedColor",
    "transferDistance",
    "hardAngle",
    "normalMethod",
    "gapSteps",
    "transferRays",
    "separateFoldedWalls",
    "serialSimplify",
];

/// The hard angle `true` names, degrees.
const HARD_ANGLE: f64 = 130.0;

/// The hard angle of `map` (`what` naming it): a number of degrees from 0 to 180, `true` the
/// method's, `false` or absent none.
fn hard_angle(map: &Map<String, Value>, what: &str) -> Result<Option<f64>> {
    match map.get("hardAngle") {
        None | Some(Value::Null) | Some(Value::Bool(false)) => Ok(None),
        Some(Value::Bool(true)) => Ok(Some(HARD_ANGLE)),
        Some(_) => ranged(map, "hardAngle", what, (0.0, 180.0)),
    }
}

/// The colour of `map` at `key`: three whole numbers from 0 to 255, red, green and blue.
fn colour(map: &Map<String, Value>, key: &str, what: &str) -> Result<Option<[u8; 3]>> {
    let Some(entry) = map.get(key).filter(|v| !v.is_null()) else {
        return Ok(None);
    };
    let refuse = || {
        OPTIONS.bad(format!(
            "{what}.{key} must be three whole numbers from 0 to 255"
        ))
    };
    let listed = entry
        .as_array()
        .filter(|a| a.len() == 3)
        .ok_or_else(refuse)?;
    let mut bytes = [0u8; 3];
    for (byte, value) in bytes.iter_mut().zip(listed) {
        let read = value.as_u64().filter(|&v| v <= 255).ok_or_else(refuse)?;
        *byte = read as u8;
    }
    Ok(Some(bytes))
}

/// The simplified layer settings of `map` (`what` naming the layer): its `simplification` object's
/// and its atlas's, every other left out defaulted; the translucency and the empty texels are the
/// layer's own (`parse::layer`).
pub(super) fn simplifying(map: &Map<String, Value>, what: &str) -> Result<HlodSimplifying> {
    let mut read = HlodSimplifying {
        sizing: atlas_sizing(map, what, SIMPLIFY_SIZING)?,
        maps: maps_of(map.get("maps"), what, Maps::default())?,
        ..HlodSimplifying::default()
    };
    set(
        &mut read.gutter,
        counted(map, "atlasGutter", what, (0, 64))?,
    );
    set(
        &mut read.double_sided,
        switch(map, "allowDoubleSided", what)?,
    );
    set(
        &mut read.group_identical,
        switch(map, "groupIdenticalMeshes", what)?,
    );
    set(
        &mut read.vertex_colours,
        switch(map, "allowVertexColors", what)?,
    );
    set(
        &mut read.reuse_lightmap_uvs,
        switch(map, "reuseLightmapUVs", what)?,
    );
    let Some(entry) = map.get("simplification").filter(|v| !v.is_null()) else {
        return Ok(read);
    };
    let what = format!("{what}.simplification");
    let named = OPTIONS.known(entry, &FIELDS, &what)?;
    let what = what.as_str();
    // At least a millimetre: the method's own floor.
    read.voxel = ranged(named, "voxel", what, (0.001, f64::MAX))?;
    set(
        &mut read.gap_width,
        ranged(named, "gapWidth", what, (0.0, f64::MAX))?,
    );
    set(
        &mut read.unresolved,
        colour(named, "unresolvedColor", what)?,
    );
    read.transfer_distance = ranged(named, "transferDistance", what, (0.0, f64::MAX))?;
    read.hard_angle = hard_angle(named, what)?;
    let methods = (&HLOD_NORMAL_METHODS[..], &HlodNormalMethod::ALL[..]);
    set(
        &mut read.normal_method,
        chosen_of(named, "normalMethod", what, methods)?,
    );
    set(
        &mut read.gap_steps,
        counted(named, "gapSteps", what, (0, 64))?,
    );
    let rays = (&HLOD_TRANSFER_RAYS[..], &HlodTransferRays::ALL[..]);
    set(
        &mut read.rays,
        chosen_of(named, "transferRays", what, rays)?,
    );
    set(
        &mut read.folded_walls,
        switch(named, "separateFoldedWalls", what)?,
    );
    set(&mut read.serial, switch(named, "serialSimplify", what)?);
    Ok(read)
}
