//! An approximated layer's settings beyond its voxel, deviation and atlas side (`approximation`,
//! an object of the layer): every step of the shell and of its bake a host may turn, each read,
//! checked against its range and defaulted to the value the method is defined with
//! (`Approximation::default`); what its atlas's empty texels hold (`emptyTexels`, a field of the
//! layer itself, `empty_texels`); and how its atlas is sized (`textureSizing` and the settings it
//! reads, fields of the layer, `sizing::atlas_sizing`). The setting kinds live in `kinds`. The
//! layer's JSON is the cache's identity (`Hlod::named`): a setting named changes the key, one left
//! out keeps it.
use super::fields::{chosen_of, counted, levelled, maps_with, ranged, set, switch};
use super::*;
use crate::compiler::validate::OPTIONS;
use crate::hlod::flatten::bake::Maps;
mod kinds;
pub use kinds::{
    HlodBase, HlodBaseCapping, HlodCapture, HlodEmptyTexels, HlodGround, HlodGroundClipping,
    HlodOcclusion, HlodPatches, HlodSimplification, HlodUvMethod, HLOD_OCCLUSIONS,
    HLOD_SIMPLIFICATIONS, HLOD_UV_METHODS,
};
mod sizing;
pub(super) use sizing::{atlas_sizing, APPROXIMATION_SIZING, MERGE_SIZING, SIMPLIFY_SIZING};
pub use sizing::{
    HlodAtlasSizing, HlodBiasFloors, HlodMapSides, APPROXIMATION_FLOORS, MERGE_FLOORS,
};

/// An approximated layer's settings, each the layer's own or its default:
/// - `voxel_clamp`: the most voxels across the bounds' diagonal (1024, from 64 to 1290);
/// - `thicken`, `thickness`: whether a thin part is thickened, to how many voxels (true, 1.5);
/// - `drop_tiny`, `tiny`: whether a tiny thin part is dropped, under how many voxels (true, 0.05);
/// - `winding_threshold`: the winding number past which a point is inside (0.5);
/// - `fill_gaps`, `gap`: whether the gaps are closed, up to how many metres (true, 0.1);
/// - `occlusion`, `occlude_from_below`: which hidden triangles are dropped, and whether a floor
///   under the shell hides what faces down (visibility, true);
/// - `simplification`, `triangle_count`, `triangles_per_area`, `pre_pass`: what the shell is
///   simplified to — the layer's deviation, 2000 triangles or 2 a square metre —, and whether a
///   fast pass goes first on a dense shell (geometric tolerance, true);
/// - `hard_normals`, `hard_normal_angle`: whether faces turning past the angle, degrees, get
///   separate normals, else one normal a vertex (true, 60);
/// - `uv_method`, `patches`, `uv_atlas_stretch`: how the shell is unwrapped (charts), the patches'
///   settings and the most stretch the `uvAtlas` charts may reach (0.1);
/// - `capture`: the bake's views; `maps`: the atlas images baked beside the base colour;
/// - `empty_texels`: what the atlas holds where it holds no chart's value (the nearest chart's);
/// - `base`: how the scene's base is closed before the solid is read (none);
/// - `ground`: how a horizontal plane clips the shell once its hidden triangles are dropped
///   (none, at height 0);
/// - `render_meshes`: whether each source mesh is read as its vertex buffers hold it, its
///   vertices split where its attributes are, rather than welded by position (false);
/// - `sizing`: how the atlas is sized (the layer's side for every map).
#[derive(Clone, Debug)]
pub struct HlodApproximation {
    pub voxel_clamp: usize,
    pub thicken: bool,
    pub thickness: f64,
    pub drop_tiny: bool,
    pub tiny: f64,
    pub winding_threshold: f64,
    pub fill_gaps: bool,
    pub gap: f64,
    pub occlusion: HlodOcclusion,
    pub occlude_from_below: bool,
    pub simplification: HlodSimplification,
    pub triangle_count: usize,
    pub triangles_per_area: f64,
    pub pre_pass: bool,
    pub hard_normals: bool,
    pub hard_normal_angle: f64,
    pub uv_method: HlodUvMethod,
    pub patches: HlodPatches,
    pub uv_atlas_stretch: f64,
    pub capture: HlodCapture,
    pub(crate) maps: Maps,
    pub empty_texels: HlodEmptyTexels,
    pub base: HlodBase,
    pub ground: HlodGround,
    pub render_meshes: bool,
    pub sizing: HlodAtlasSizing,
}

impl Default for HlodApproximation {
    fn default() -> Self {
        Self {
            voxel_clamp: 1024,
            thicken: true,
            thickness: 1.5,
            drop_tiny: true,
            tiny: 0.05,
            winding_threshold: 0.5,
            fill_gaps: true,
            gap: 0.1,
            occlusion: HlodOcclusion::Visibility,
            occlude_from_below: true,
            simplification: HlodSimplification::GeometricTolerance,
            triangle_count: 2000,
            triangles_per_area: 2.0,
            pre_pass: true,
            hard_normals: true,
            hard_normal_angle: 60.0,
            uv_method: HlodUvMethod::Charts,
            patches: HlodPatches::default(),
            uv_atlas_stretch: 0.1,
            capture: HlodCapture::default(),
            maps: Maps::default(),
            empty_texels: HlodEmptyTexels::default(),
            base: HlodBase::default(),
            ground: HlodGround::default(),
            render_meshes: false,
            sizing: HlodAtlasSizing::default(),
        }
    }
}

/// The fields `approximation` admits.
const FIELDS: [&str; 34] = [
    "voxelClamp",
    "autoThicken",
    "thicknessMultiplier",
    "ignoreTinyParts",
    "tinyPartMultiplier",
    "windingThreshold",
    "fillGaps",
    "gapDistance",
    "occlusion",
    "occludeFromBelow",
    "simplification",
    "triangleCount",
    "trianglesPerSquareMetre",
    "simplifyPrePass",
    "hardNormals",
    "hardNormalAngle",
    "uvMethod",
    "uvAtlasStretch",
    "initialPatches",
    "curvatureAlignment",
    "mergingThreshold",
    "maxAngleDeviation",
    "captureResolution",
    "captureFieldOfView",
    "nearPlane",
    "multiSampling",
    "captureAnisotropy",
    "maps",
    "baseCapping",
    "baseHeight",
    "baseThickness",
    "groundClipping",
    "groundHeight",
    "useRenderLODMeshes",
];

/// The fields an approximated layer's `approximation.maps` admits: the images baked beside the
/// base colour.
const MAP_FIELDS: [&str; 5] = ["normal", "roughness", "metallic", "specular", "emissive"];

/// Any finite number: a height the method reads with any sign.
const FINITE: (f64, f64) = (f64::MIN, f64::MAX);

/// What the atlas of layer `map` (`what` naming it) holds where it holds no chart's value
/// (`emptyTexels`, `HlodEmptyTexels`).
pub(super) fn empty_texels(map: &Map<String, Value>, what: &str) -> Result<HlodEmptyTexels> {
    let levels = (&HLOD_EMPTY_TEXELS[..], DEFAULT_HLOD_EMPTY_TEXELS);
    levelled(map, "emptyTexels", what, levels, &HlodEmptyTexels::ALL)
}

/// The approximation settings `entry` names (`what` naming it), every field checked, the others
/// defaulted; the defaults when it is absent or null.
pub(super) fn approximation(entry: Option<&Value>, what: &str) -> Result<HlodApproximation> {
    let mut read = HlodApproximation::default();
    let Some(entry) = entry.filter(|v| !v.is_null()) else {
        return Ok(read);
    };
    let what = format!("{what}.approximation");
    let map = OPTIONS.known(entry, &FIELDS, &what)?;
    let what = what.as_str();
    set(
        &mut read.voxel_clamp,
        counted(map, "voxelClamp", what, (64, 1290))?,
    );
    set(&mut read.thicken, switch(map, "autoThicken", what)?);
    let multiplier = (0.001, f64::MAX);
    set(
        &mut read.thickness,
        ranged(map, "thicknessMultiplier", what, multiplier)?,
    );
    set(&mut read.drop_tiny, switch(map, "ignoreTinyParts", what)?);
    set(
        &mut read.tiny,
        ranged(map, "tinyPartMultiplier", what, multiplier)?,
    );
    set(
        &mut read.winding_threshold,
        ranged(map, "windingThreshold", what, (0.01, 0.99))?,
    );
    set(&mut read.fill_gaps, switch(map, "fillGaps", what)?);
    set(
        &mut read.gap,
        ranged(map, "gapDistance", what, (0.001, f64::MAX))?,
    );
    let occlusions = (&HLOD_OCCLUSIONS[..], &HlodOcclusion::ALL[..]);
    set(
        &mut read.occlusion,
        chosen_of(map, "occlusion", what, occlusions)?,
    );
    set(
        &mut read.occlude_from_below,
        switch(map, "occludeFromBelow", what)?,
    );
    let simplifications = (&HLOD_SIMPLIFICATIONS[..], &HlodSimplification::ALL[..]);
    set(
        &mut read.simplification,
        chosen_of(map, "simplification", what, simplifications)?,
    );
    // A count held in a signed 32-bit word, a density in a single-precision number: what the
    // method's settings hold them in.
    let count = (16, i32::MAX as usize);
    set(
        &mut read.triangle_count,
        counted(map, "triangleCount", what, count)?,
    );
    let density = (0.01, f64::from(f32::MAX));
    set(
        &mut read.triangles_per_area,
        ranged(map, "trianglesPerSquareMetre", what, density)?,
    );
    set(&mut read.pre_pass, switch(map, "simplifyPrePass", what)?);
    set(&mut read.hard_normals, switch(map, "hardNormals", what)?);
    // Held within an open quarter turn, as the crease test reads it.
    let angle = ranged(map, "hardNormalAngle", what, (0.0, 90.0))?;
    set(
        &mut read.hard_normal_angle,
        angle.map(|v| v.clamp(0.001, 89.99)),
    );
    let methods = (&HLOD_UV_METHODS[..], &HlodUvMethod::ALL[..]);
    set(
        &mut read.uv_method,
        chosen_of(map, "uvMethod", what, methods)?,
    );
    // The stretch bound of the library's scale, from 0 (none) to 1 (any).
    set(
        &mut read.uv_atlas_stretch,
        ranged(map, "uvAtlasStretch", what, (0.0, 1.0))?,
    );
    read.patches = HlodPatches::read(map, what)?;
    // Zero: each view as large as the atlas.
    let resolution = counted(map, "captureResolution", what, (0, 16384))?;
    set(
        &mut read.capture.resolution,
        resolution.map(|v| (v > 0).then_some(v)),
    );
    set(
        &mut read.capture.field_of_view,
        ranged(map, "captureFieldOfView", what, (5.0, 160.0))?,
    );
    set(
        &mut read.capture.near_plane,
        ranged(map, "nearPlane", what, (0.00001, 10.0))?,
    );
    set(
        &mut read.capture.multisampling,
        counted(map, "multiSampling", what, (0, 8))?,
    );
    // A sampler's anisotropy clamp, one sample to sixteen.
    set(
        &mut read.capture.anisotropy,
        counted(map, "captureAnisotropy", what, (1, 16))?,
    );
    read.maps = maps_with(map.get("maps"), what, read.maps, &MAP_FIELDS)?;
    let capping = (&HLOD_BASE_CAPPINGS[..], DEFAULT_HLOD_BASE_CAPPING);
    read.base.capping = levelled(map, "baseCapping", what, capping, &HlodBaseCapping::ALL)?;
    // Zero for each: the method's own height and thickness (`HlodBase`); a slab rises from the
    // base, never under it.
    set(
        &mut read.base.height,
        ranged(map, "baseHeight", what, (0.0, f64::MAX))?,
    );
    set(
        &mut read.base.thickness,
        ranged(map, "baseThickness", what, (0.0, f64::MAX))?,
    );
    let clipping = (&HLOD_GROUND_CLIPPINGS[..], DEFAULT_HLOD_GROUND_CLIPPING);
    read.ground.clipping = levelled(
        map,
        "groundClipping",
        what,
        clipping,
        &HlodGroundClipping::ALL,
    )?;
    set(
        &mut read.ground.height,
        ranged(map, "groundHeight", what, FINITE)?,
    );
    set(
        &mut read.render_meshes,
        switch(map, "useRenderLODMeshes", what)?,
    );
    Ok(read)
}
