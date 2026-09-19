//! Resident proxy: geometry light rays hit.
//!
//! Light ray cannot trace visible cut: depends on camera, changes
//! each frame, leaves too fine for ray budget. Compiler retains
//! once for all coarse DAG level — clusters whose certified geometric error
//! drops below meter threshold — places in world, assigns material albedo,
//! builds BVH on top. Fits in cache and remains resident in
//! GPU memory regardless of viewpoint.
//!
//! No light baked here: proxy carries geometry and materials, nothing else.
use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::{transform_point, world_matrices, Mat4};
use crate::texture_preview::TexturePreview;
use crate::Result;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub mod albedo;
pub(crate) mod assemble;
pub mod bvh;
pub mod cut;
pub mod encode;
pub mod simplify;
pub mod wide;

/// Product contract. Moving cut, sections or node order requires incrementing.
pub const SCENE_PROXY_VERSION: u32 = 2;
/// 'W','G','P','X' read as 32-bit little-endian unsigned int.
pub const SCENE_PROXY_MAGIC: u32 = 0x5850_4757;
/// Header integers: signature, version, triangles, nodes.
pub const SCENE_PROXY_HEADER_WORDS: usize = 4;
/// Product name in cache key folder, next to `clusters.json`.
pub const SCENE_PROXY_FILE: &str = "proxy.bin";
/// Max certified geometric error of retained cluster, in meters. Published setting.
pub const PROXY_ERROR_METRES: f64 = 0.05;
/// Proxy mesh floor, in meters: triangle size after simplification,
/// surface cache resolution. Triangle budget doubles if needed.
pub const PROXY_CELL_METRES: f64 = 0.5;
/// BVH leaf triangles: leaf loop bounded by this count engine side.
pub const PROXY_LEAF_TRIANGLES: usize = 8;
/// Triangles entire scene proxy allows itself, all instances placed. Budget
/// decides actually obtained threshold: 10M triangle scene outputs 30x
/// coarser than single room, threshold published in manifest.
pub const PROXY_TRIANGLE_BUDGET: usize = 300_000;
/// Numbers per triangle: three world vertices. Normal derived from triangle, un-stored.
pub const PROXY_TRIANGLE_FLOATS: usize = 9;
/// Numbers per node: min then max exact bounds, reference for child
/// quantized boxes.
pub const PROXY_NODE_FLOATS: usize = 6;
/// BVH node children: four boxes tested at once, closest kept for next step.
pub const PROXY_CHILDREN: usize = 4;
/// Integers per child: two quantized box and link words, link itself.
pub const PROXY_CHILD_WORDS: usize = 3;
/// Integers per node: four children end to end.
pub const PROXY_NODE_WORDS: usize = PROXY_CHILDREN * PROXY_CHILD_WORDS;

/// Scene proxy, ready for column output.
#[derive(Default)]
pub struct SceneProxy {
    pub bounds: [f64; 6],
    /// Max threshold primitive took to fit budget share, plus
    /// proxy simplification addition.
    pub error_metres: f64,
    /// Grid step simplification took, in meters: proxy triangle size,
    /// surface cache cell size.
    pub cell_metres: f64,
    pub triangles: Vec<f32>,
    pub albedo: Vec<u32>,
    pub node_bounds: Vec<f32>,
    pub node_children: Vec<u32>,
}
impl SceneProxy {
    pub fn triangle_count(&self) -> usize {
        self.triangles.len() / PROXY_TRIANGLE_FLOATS
    }
    pub fn node_count(&self) -> usize {
        self.node_children.len() / PROXY_NODE_WORDS
    }
}

/// Step reads: scene, retained coarse cuts, texture previews.
pub struct ProxyInputs<'a> {
    pub g: &'a Value,
    pub chosen: &'a BTreeSet<usize>,
    pub mesh_map: &'a BTreeMap<usize, usize>,
    pub primitives: &'a [Value],
    /// Per compiled primitive: coarse cut vertices, in object space.
    pub cuts: &'a [Vec<f32>],
    /// Per compiled primitive: threshold cut requested, in meters.
    pub thresholds: &'a [f64],
    pub previews: &'a [TexturePreview],
}

/// World matrix scale factor: longest of three linear columns.
/// Object error multiplier when becoming world error, up to upper bound.
pub fn world_scale(matrix: &Mat4) -> f64 {
    (0..3)
        .map(|column| {
            (matrix[column * 4].powi(2)
                + matrix[column * 4 + 1].powi(2)
                + matrix[column * 4 + 2].powi(2))
            .sqrt()
        })
        .fold(0.0f64, f64::max)
}

/// Max world scale under which each source mesh placed. Primitive placed
/// twice at two scales takes largest: cut finer than needed for
/// other instance, never coarser than threshold allows.
pub fn mesh_scales(g: &Value, chosen: &BTreeSet<usize>) -> Result<BTreeMap<usize, f64>> {
    let world = world_matrices(g)?;
    let nodes = values(g, "nodes")?;
    let mut scales: BTreeMap<usize, f64> = BTreeMap::new();
    for node_id in chosen {
        let node = item(nodes, *node_id, "node")?;
        let mesh = required_index(node.get("mesh"), "node.mesh")?;
        let scale = world_scale(&world[*node_id]);
        let slot = scales.entry(mesh).or_insert(0.0);
        if scale > *slot {
            *slot = scale;
        }
    }
    Ok(scales)
}

/// Compiled primitives of each mesh, in original order: without table, each
/// retained node would sweep all scene primitives to find own.
fn primitives_by_mesh(primitives: &[Value]) -> BTreeMap<u64, Vec<usize>> {
    let mut by_mesh: BTreeMap<u64, Vec<usize>> = BTreeMap::new();
    for (index, primitive) in primitives.iter().enumerate() {
        if let Some(mesh) = primitive.get("mesh").and_then(Value::as_u64) {
            by_mesh.entry(mesh).or_default().push(index);
        }
    }
    by_mesh
}

/// Places each coarse cut in world, once per carrying node, then builds
/// BVH. Primitive placed 10 times yields 10 triangle sets: proxy is a scene, not
/// object catalog, ray has no matrix to apply.
pub fn stage_proxy(inputs: &ProxyInputs<'_>) -> Result<SceneProxy> {
    let world = world_matrices(inputs.g)?;
    let nodes = values(inputs.g, "nodes")?;
    let palette = albedo::material_albedo(inputs.g, inputs.previews);
    let mut triangles: Vec<f32> = Vec::new();
    let mut colours: Vec<u32> = Vec::new();
    let by_mesh = primitives_by_mesh(inputs.primitives);
    for node_id in inputs.chosen {
        let node = item(nodes, *node_id, "node")?;
        let old_mesh = required_index(node.get("mesh"), "node.mesh")?;
        let Some(mesh_index) = inputs.mesh_map.get(&old_mesh).copied() else {
            continue;
        };
        let matrix = world[*node_id];
        let Some(indices) = by_mesh.get(&(mesh_index as u64)) else {
            continue;
        };
        for index in indices.iter().copied() {
            let Some(cut) = inputs.cuts.get(index) else {
                continue;
            };
            let colour = palette.of(inputs.primitives[index].get("material"));
            place(cut, &matrix, &mut triangles);
            colours.resize(triangles.len() / PROXY_TRIANGLE_FLOATS, colour);
        }
    }
    Ok(assemble::assemble(inputs.thresholds, triangles, colours))
}

/// Cut vertices, transformed once by placing node.
pub(crate) fn place(cut: &[f32], matrix: &Mat4, out: &mut Vec<f32>) {
    out.reserve(cut.len());
    for vertex in cut.as_chunks::<3>().0 {
        let world = transform_point(
            matrix,
            [vertex[0] as f64, vertex[1] as f64, vertex[2] as f64],
        );
        out.push(world[0] as f32);
        out.push(world[1] as f32);
        out.push(world[2] as f32);
    }
}
