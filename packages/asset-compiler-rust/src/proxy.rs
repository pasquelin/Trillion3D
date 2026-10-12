use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::{world_matrices, Mat4};
use crate::texture_preview::TexturePreview;
use crate::Result;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_math::matrix::transform_point;

pub mod albedo;
/// The proxy's pure geometry — snapping, BVH, wide collapse — and its layout numbers live in the page codec,
/// the crate the browser's one WebAssembly module and the compiler share: one builder.
pub use trillion3d_page_codec::proxy::{
    build_columns, bvh, simplify, wide, Built, PROXY_CELL_METRES, PROXY_CHILDREN,
    PROXY_CHILD_WORDS, PROXY_ERROR_METRES, PROXY_LEAF_TRIANGLES, PROXY_NODE_FLOATS,
    PROXY_NODE_WORDS, PROXY_TRIANGLE_BUDGET, PROXY_TRIANGLE_FLOATS,
};
pub(crate) mod assemble;
pub mod cut;
pub mod encode;
pub mod provenance;
pub mod share;
pub(crate) mod tracer;

/// Version of the "proxy" cache product. A proxy of another version is rejected, never guessed.
pub const SCENE_PROXY_VERSION: u32 = 5;
/// 'W','G','P','X' read as an unsigned 32-bit integer little-endian.
pub const SCENE_PROXY_MAGIC: u32 = 0x5850_4757;
/// Header integers: v3 ownership header, then shape, stored-triangle and placement counts.
pub const SCENE_PROXY_HEADER_WORDS: usize = 11;
/// Product name in cache key folder, next to `clusters.json`.
pub const SCENE_PROXY_FILE: &str = "proxy.bin";

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
    pub provenance: provenance::Provenance,
    pub sharing: share::Sharing,
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
    /// The chosen nodes no hidden node hides: the proxy stands in for what is drawn.
    pub shown: &'a BTreeSet<usize>,
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
pub use trillion3d_math::linear::longest_column as world_scale;

/// A length of `metres` in the object units of a primitive: the rule the tile grid shares.
pub use trillion3d_page_codec::bits::grid::object_units;

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
pub(crate) fn primitives_by_mesh(primitives: &[Value]) -> BTreeMap<u64, Vec<usize>> {
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
    let mut owners = Vec::new();
    let by_mesh = primitives_by_mesh(inputs.primitives);
    for node_id in inputs.shown {
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
            owners.resize(colours.len(), *node_id as u32);
        }
    }
    let mut proxy =
        assemble::assemble_owned(inputs.thresholds, triangles, colours, &owners, &world);
    proxy.provenance.source_parents = vec![-1; world.len()];
    for id in 0..nodes.len() {
        for child in crate::compiler_nodes::children_of(nodes, id)? {
            proxy.provenance.source_parents[child] = id as i32;
        }
    }
    // The compiled mesh (`mesh_map`) each node places: a cell node casts as it says.
    proxy.provenance.source_meshes = nodes
        .iter()
        .map(|node| {
            let mesh = node.get("mesh").and_then(Value::as_u64);
            mesh.and_then(|m| inputs.mesh_map.get(&(m as usize)))
                .map_or(-1, |m| *m as i32)
        })
        .collect();
    Ok(proxy)
}

/// Cut vertices, transformed once by placing node.
pub(crate) fn place(cut: &[f32], matrix: &Mat4, out: &mut Vec<f32>) {
    out.reserve(cut.len());
    for vertex in cut.as_chunks::<3>().0 {
        let world = transform_point(matrix, vertex.map(f64::from));
        out.push(world[0] as f32);
        out.push(world[1] as f32);
        out.push(world[2] as f32);
    }
}
