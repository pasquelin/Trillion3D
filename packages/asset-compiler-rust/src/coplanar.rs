//! Coplanar depth layers.
//!
//! Two opaque surfaces that lie in exactly the same plane have no winner: the depth test compares
//! two interpolations of the same geometric value, and the last bit of each decides per pixel. The
//! two surfaces are triangulated differently, so that bit differs from tile to tile and one texture
//! appears in rectangles inside the other.
//!
//! This stage decides the order once, at compile time, from the scene itself: surfaces sharing a
//! plane are stacked, the thinner one on top, and every cluster of a stacked surface records the
//! layer it landed on. At render time a layer is one integer unit of depth bias, the same value on
//! every path — nothing is computed per pixel and no vertex moves.
//!
//! Only opaque surfaces without an alpha mask take part. Transparent and masked surfaces keep the
//! order they already had, and a surface that shares its plane with nobody keeps layer 0, which is
//! the untouched draw.
use crate::compiler_accessor_create::accessor;
use crate::compiler_materials::unsplit_material;
use crate::compiler_validate::{item, required_index, values};
use crate::Result;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub mod assign;
pub mod groups;
pub mod overlap;
pub mod pairs;
pub mod placement;
pub mod plane;
pub mod report;
pub mod surface;

pub use assign::Overlap;
pub use plane::ClusterPlane;
pub use report::Counts;
pub use surface::Surface;

/// Versioned contract of this stage. A cache names the stage that produced its layers, so a reader
/// never has to guess what a layer number meant.
pub const COPLANAR_STAGE: &str = "coplanar-depth-layers-v1";
/// Layers are stored in four bits, so a stack of seventeen surfaces is one too many and says so.
pub const COPLANAR_MAX_LAYER: u32 = 15;

/// Every limit the stage works within. They are published in the report, so a scene that hits one
/// is visible instead of silently half-analysed.
pub struct CoplanarBounds {
    pub max_planes_per_primitive: usize,
    pub max_surfaces_per_plane: usize,
    pub max_pairs: usize,
    pub max_triangles_per_surface: usize,
    pub grid: usize,
    pub min_overlap_cells: usize,
    /// A cluster is flat when every vertex sits within this fraction of its own size of the plane.
    pub flatness_ratio: f64,
}
impl Default for CoplanarBounds {
    fn default() -> Self {
        Self {
            max_planes_per_primitive: 64,
            max_surfaces_per_plane: 64,
            max_pairs: 4096,
            max_triangles_per_surface: 2_000_000,
            grid: 256,
            min_overlap_cells: 1,
            flatness_ratio: 1e-5,
        }
    }
}

pub struct CoplanarInputs<'a> {
    pub g: &'a Value,
    pub bin: &'a [u8],
    pub chosen: &'a BTreeSet<usize>,
    pub mesh_map: &'a BTreeMap<usize, usize>,
    /// Compiled mesh index back to the glTF mesh it came from.
    pub source_mesh: &'a BTreeMap<usize, usize>,
    pub primitives: &'a [Value],
    /// Per primitive, per page: the plane the cluster lies in, when it lies in one.
    pub cluster_planes: &'a [Vec<Option<ClusterPlane>>],
    /// Distance step the world planes are hashed and compared with, from the size of the scene.
    pub offset_quantum: f64,
    pub cancelled: &'a (dyn Fn() -> Result<()> + Sync),
    /// One event per bounded slice of work, so a host sees the stage advance instead of a pause.
    pub progress: &'a (dyn Fn(Value) + Sync),
}

pub struct CoplanarResult {
    /// Per primitive, per page: 0 for an untouched cluster, otherwise the layer it draws on.
    pub layers: Vec<Vec<u32>>,
    pub report: Value,
}

/// The distance step world planes are compared with, from the size of the scene: one part in a
/// million of its longest side, so the same surface always hashes to the same plane whatever
/// instance carried it, and two floors a millimetre apart stay two floors.
///
/// Not `shared_math::extend_aabb` loop: each axis bound read and kept
/// separately, readable page without `min` still carrying `max`.
pub fn offset_quantum(primitives: &[Value]) -> f64 {
    let mut low = [f64::INFINITY; 3];
    let mut high = [f64::NEG_INFINITY; 3];
    for primitive in primitives {
        for page in primitive
            .get("pages")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            for axis in 0..3 {
                if let Some(value) = page["min"][axis].as_f64() {
                    low[axis] = low[axis].min(value);
                }
                if let Some(value) = page["max"][axis].as_f64() {
                    high[axis] = high[axis].max(value);
                }
            }
        }
    }
    let extent = (0..3).fold(0.0f64, |best, axis| best.max(high[axis] - low[axis]));
    if extent.is_finite() && extent > 0.0 {
        (extent * 1e-6).clamp(1e-9, 1e-2)
    } else {
        1e-6
    }
}

/// Stacks the coplanar opaque surfaces of a scene and hands back one layer per cluster.
pub fn assign_depth_layers(
    inputs: &CoplanarInputs<'_>,
    bounds: &CoplanarBounds,
) -> Result<CoplanarResult> {
    let mut counts = Counts::default();
    // World matrices serve both passes: single construction for whole step.
    let world = crate::compiler_world::world_matrices(inputs.g)?;
    let surfaces = surface::collect_with_world(inputs, bounds, &mut counts.dropped_planes, &world)?;
    let overlaps = pairs::find_overlaps(inputs, bounds, &surfaces, &mut counts, &world)?;
    let (assigned, overflow) = assign::layers(&surfaces, &overlaps, COPLANAR_MAX_LAYER);
    counts.layer_overflow = overflow;
    let mut layers: Vec<Vec<u32>> = inputs
        .primitives
        .iter()
        .map(|primitive| {
            vec![
                0u32;
                primitive
                    .get("pages")
                    .and_then(Value::as_array)
                    .map_or(0, Vec::len)
            ]
        })
        .collect();
    for (index, surface) in surfaces.iter().enumerate() {
        if assigned[index] == 0 {
            continue;
        }
        for page in &surface.pages {
            let slot = &mut layers[surface.primitive][*page];
            // One primitive can be placed several times; an instance that disagrees keeps the
            // higher layer and is counted, so the conflict is visible rather than order-dependent.
            if *slot != 0 && *slot != assigned[index] {
                counts.instance_conflicts += 1;
            }
            *slot = (*slot).max(assigned[index]);
        }
    }
    counts.layered_pages = layers
        .iter()
        .map(|primitive| primitive.iter().filter(|layer| **layer > 0).count())
        .sum();
    let report = report::report(
        &surfaces,
        &overlaps,
        &assigned,
        &counts,
        bounds,
        inputs.offset_quantum,
    );
    Ok(CoplanarResult { layers, report })
}
