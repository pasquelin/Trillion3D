//! The kinds an approximated layer's settings take: which hidden triangles the shell drops, what
//! it is simplified to, how it is unwrapped, what its atlas holds where no chart is, the patches
//! unwrap's settings, the bake's views, how the scene's base is closed and how the ground plane
//! clips the shell — each with its words, in its enum's order, and its default.
use super::super::fields::{counted, default_rank, ranged, set};
use super::*;

/// Which triangles of the shell are dropped as hidden (`occlusion`, `HLOD_OCCLUSIONS` order).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodOcclusion {
    /// The triangles no ray from outside reaches (`'visibility'`, the default).
    Visibility,
    /// None (`'none'`).
    None,
}

impl HlodOcclusion {
    pub(super) const ALL: [Self; 2] = [Self::Visibility, Self::None];
}

/// What the shell's simplification aims for (`simplification`, `HLOD_SIMPLIFICATIONS` order).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodSimplification {
    /// Down to the layer's geometric deviation (`'geometricTolerance'`, the default).
    GeometricTolerance,
    /// Down to `trianglesPerSquareMetre` of the shell's area (`'trianglesPerArea'`).
    TrianglesPerArea,
    /// Down to `triangleCount` triangles (`'fixedTriangleCount'`).
    FixedTriangleCount,
}

impl HlodSimplification {
    pub(super) const ALL: [Self; 3] = [
        Self::GeometricTolerance,
        Self::TrianglesPerArea,
        Self::FixedTriangleCount,
    ];
}

/// How a mesh baked on its own triangles is given unique texture coordinates (`uvMethod`): an
/// approximated layer's shell takes the first three (`HLOD_UV_METHODS` order), a merged layer's
/// mesh any of the four (`HLOD_MERGE_UV_METHODS`, `options/merging.rs`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodUvMethod {
    /// Charts grown by cost and flattened conformally, then packed (`'charts'`, the default:
    /// `flatten/uv/charts.rs`).
    Charts,
    /// Patches grown by normal-weighed distance and merged into islands (`'patches'`:
    /// `flatten/uv/unwrap.rs`).
    Patches,
    /// Charts cut by spectral analysis of the surface — as many as keep their stretch under the
    /// bound: `uvAtlasStretch` on a shell, 0.11 on a merged mesh — and packed (`'uvAtlas'`:
    /// `flatten/uv/unwrap/atlas.rs`).
    UvAtlas,
    /// A merged layer's old chart layout of the mesh's own first texture set (`'legacy'`:
    /// `flatten/uv/legacy.rs`); a mesh it finds no layout for takes the patches unwrap.
    Legacy,
}

impl HlodUvMethod {
    /// The methods of an approximated layer, in `HLOD_UV_METHODS` order.
    pub(super) const ALL: [Self; 3] = [Self::Charts, Self::Patches, Self::UvAtlas];
}

/// What an approximated layer's atlas holds where it holds no chart's value — its empty texels,
/// outside every chart, and its gutter's copies of texels no view sees — (`emptyTexels`,
/// `HLOD_EMPTY_TEXELS` order, `bake::captured`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodEmptyTexels {
    /// What the bake writes there (`'black'`, what `false` names): black, the frame's up on the
    /// normal map, zero on a baked roughness, metallic, specular or emission — the holes beside
    /// them filled from it and the averaging down and the mips reading it, a chart's border
    /// darkened from far.
    Black,
    /// The nearest chart's values on every image, the normal map's too (`'nearestChart'`, the
    /// default, what `true` names), given before the holes are filled and the atlas averaged down:
    /// ring by ring outward from the charts, each texel the mean of its neighbours holding one
    /// (`raster::dilate`), so no black reaches a chart's border nor a mip.
    NearestChart,
}

impl HlodEmptyTexels {
    pub(super) const ALL: [Self; 2] = [Self::Black, Self::NearestChart];
}

impl Default for HlodEmptyTexels {
    /// The one `DEFAULT_HLOD_EMPTY_TEXELS` names.
    fn default() -> Self {
        Self::ALL[default_rank(&HLOD_EMPTY_TEXELS, DEFAULT_HLOD_EMPTY_TEXELS)]
    }
}

/// The words `occlusion`, `simplification` and `uvMethod` take, in their enums' order.
pub const HLOD_OCCLUSIONS: [&str; 2] = ["visibility", "none"];
pub const HLOD_SIMPLIFICATIONS: [&str; 3] = [
    "geometricTolerance",
    "trianglesPerArea",
    "fixedTriangleCount",
];
pub const HLOD_UV_METHODS: [&str; 3] = ["charts", "patches", "uvAtlas"];

// A word without a method in `HlodUvMethod::ALL` would index past it (`chosen_of`).
const _: () = assert!(HLOD_UV_METHODS.len() == HlodUvMethod::ALL.len());

/// The patches unwrap's settings (`uvMethod: 'patches'`): the initial patch count, the weight of
/// the normal's turn in the patches' growth, the mean squared area distortion an island may
/// reach, and the normal deviation, degrees, two merged patches may differ by.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct HlodPatches {
    pub initial: usize,
    pub curvature_alignment: f64,
    pub merging_threshold: f64,
    pub max_angle_deviation: f64,
}

impl Default for HlodPatches {
    fn default() -> Self {
        Self {
            initial: 250,
            curvature_alignment: 1.0,
            merging_threshold: 1.5,
            max_angle_deviation: 45.0,
        }
    }
}

impl HlodPatches {
    /// The settings `map` names (`what` naming the layer's approximation), each checked against
    /// its range, the others defaulted.
    pub(super) fn read(map: &Map<String, Value>, what: &str) -> Result<Self> {
        let mut read = Self::default();
        let initial = counted(map, "initialPatches", what, (1, 99_999_999))?;
        set(&mut read.initial, initial);
        let alignment = ranged(map, "curvatureAlignment", what, (0.01, 100.0))?;
        set(&mut read.curvature_alignment, alignment);
        let merging = ranged(map, "mergingThreshold", what, (1.0, f64::MAX))?;
        set(&mut read.merging_threshold, merging);
        let deviation = ranged(map, "maxAngleDeviation", what, (0.0, 180.0))?;
        set(&mut read.max_angle_deviation, deviation);
        Ok(read)
    }
}

/// The bake's views of the sources (`flatten/bake/capture.rs`): each view's side in pixels — none,
/// the layer's atlas side —, its horizontal field of view, degrees, its near plane, metres, the
/// supersampling of the atlas, per side (0 and 1 none), and the most samples a texture read takes
/// along its footprint's longer side (`anisotropy`): the sampler's anisotropy clamp of the views,
/// 8 by default, the clamp a view draws its textures with at the highest texture quality.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct HlodCapture {
    pub resolution: Option<usize>,
    pub field_of_view: f64,
    pub near_plane: f64,
    pub multisampling: usize,
    pub anisotropy: usize,
}

impl Default for HlodCapture {
    fn default() -> Self {
        Self {
            resolution: Some(2048),
            field_of_view: 30.0,
            near_plane: 0.01,
            multisampling: 0,
            anisotropy: 8,
        }
    }
}

/// How the scene's base is closed before the solid is read (`baseCapping`, `HLOD_BASE_CAPPINGS`
/// order, `approximate/scene/base.rs`): not at all; by the convex hull of the vertices within the
/// base's height above the scene's lowest point, a flat polygon at that lowest point facing down,
/// which makes the scene read as open meshes; or that polygon extruded up into a slab.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodBaseCapping {
    /// No cap (`'none'`, the default, what `true` and `false` name).
    None,
    /// The flat hull facing down (`'convexPolygon'`).
    ConvexPolygon,
    /// The hull extruded into a slab (`'convexSolid'`).
    ConvexSolid,
}

impl HlodBaseCapping {
    pub(super) const ALL: [Self; 3] = [Self::None, Self::ConvexPolygon, Self::ConvexSolid];
}

impl Default for HlodBaseCapping {
    /// The one `DEFAULT_HLOD_BASE_CAPPING` names.
    fn default() -> Self {
        Self::ALL[default_rank(&HLOD_BASE_CAPPINGS, DEFAULT_HLOD_BASE_CAPPING)]
    }
}

/// The base cap's settings: how it closes the base (`capping`), the height above the scene's
/// lowest point whose vertices it hulls, metres — zero, twice the layer's voxel (`baseHeight`) —,
/// and a slab's thickness, metres — zero, the thickening's thickness when the layer thickens thin
/// parts, else one and a quarter voxels (`baseThickness`).
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct HlodBase {
    pub capping: HlodBaseCapping,
    pub height: f64,
    pub thickness: f64,
}

/// How a horizontal ground plane clips the shell (`groundClipping`, `HLOD_GROUND_CLIPPINGS`
/// order): not at all; its triangles whose three corners lie on or under the plane dropped with
/// the hidden ones — only when the occlusion filter drops some —; the shell cut along the plane,
/// what lies under it removed (`approximate/ground.rs`); or cut and each cut loop filled flat.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HlodGroundClipping {
    /// No clipping (`'none'`, the default, what `true` and `false` name).
    None,
    /// Triangles wholly under the plane dropped with the hidden ones (`'discard'`).
    Discard,
    /// Cut along the plane (`'cut'`).
    Cut,
    /// Cut along the plane, each cut loop filled (`'cutAndFill'`).
    CutAndFill,
}

impl HlodGroundClipping {
    pub(super) const ALL: [Self; 4] = [Self::None, Self::Discard, Self::Cut, Self::CutAndFill];
}

impl Default for HlodGroundClipping {
    /// The one `DEFAULT_HLOD_GROUND_CLIPPING` names.
    fn default() -> Self {
        Self::ALL[default_rank(&HLOD_GROUND_CLIPPINGS, DEFAULT_HLOD_GROUND_CLIPPING)]
    }
}

/// The ground plane's settings: how it clips the shell (`clipping`) and its height, the world's
/// up coordinate, metres (`groundHeight`, 0).
#[derive(Clone, Copy, PartialEq, Debug, Default)]
pub struct HlodGround {
    pub clipping: HlodGroundClipping,
    pub height: f64,
}
