use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::world_matrices;
use crate::texture_preview::TexturePreview;
use crate::Result;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use trillion3d_math::aabb::{grow_flat, EMPTY_FLAT};
use trillion3d_math::box_transform::{box_transform, BOX_VALUES};
use trillion3d_math::linear::longest_column;
// The proxy's pure geometry — snapping, BVH, wide collapse — and its layout numbers live in the
// page codec, the crate the browser's one WebAssembly module and the compiler share: one builder.
use trillion3d_page_codec::proxy::{
    bvh, columns_of, simplify, CutColumns, PROXY_ERROR_METRES, PROXY_NODE_WORDS,
    PROXY_TRIANGLE_FLOATS,
};

pub mod albedo;
pub mod cut;
pub mod encode;
pub mod placement;
pub(crate) mod tracer;

/// Version of the "proxy" cache product. A proxy of another version is rejected, never guessed.
pub const SCENE_PROXY_VERSION: u32 = 6;
/// 'W','G','P','X' read as an unsigned 32-bit integer little-endian.
pub const SCENE_PROXY_MAGIC: u32 = 0x5850_4757;
/// Header integers: magic, version, the meshes the table names, then the triangles and the nodes
/// all of them hold, and one reserved word.
pub const SCENE_PROXY_HEADER_WORDS: usize = 6;
/// Product name in cache key folder, next to `clusters.json`.
pub const SCENE_PROXY_FILE: &str = "proxy.bin";

/// Scene proxy, ready for column output: ONE PROXY A COMPILED MESH, in the mesh's own space, whatever
/// the number of nodes that place it. The engine places it where a node does, by the node's live
/// world (`sdk-browser/src/gpu/dag/proxyInstances.ts`): an instance is four words, not a copy.
#[derive(Default)]
pub struct SceneProxy {
    /// The world extent of the placements, three lower bounds then three upper.
    pub bounds: [f64; 6],
    /// Max threshold a cut took to fit its budget share, plus the grid addition of the coarsest
    /// proxy at the largest scale it is placed at.
    pub error_metres: f64,
    /// That grid step, in metres.
    pub cell_metres: f64,
    /// One entry per compiled primitive, in primitive order; a primitive no shown node places holds none.
    pub meshes: Vec<CutColumns>,
}
impl SceneProxy {
    pub fn triangle_count(&self) -> usize {
        self.meshes
            .iter()
            .map(|mesh| mesh.triangles.len() / PROXY_TRIANGLE_FLOATS)
            .sum()
    }
    pub fn node_count(&self) -> usize {
        self.meshes
            .iter()
            .map(|mesh| mesh.node_children.len() / PROXY_NODE_WORDS)
            .sum()
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

/// The proxy of each compiled primitive a shown node places, once: its coarse cut built into a wide
/// tree in the primitive's own space (`columns_of`, the builder the browser's cuts go through), with the
/// colour of its material. A primitive placed ten times is one proxy: the engine places it, a ray has the
/// node's world to apply.
pub fn stage_proxy(inputs: &ProxyInputs<'_>) -> Result<SceneProxy> {
    let world = world_matrices(inputs.g)?;
    let nodes = values(inputs.g, "nodes")?;
    let palette = albedo::material_albedo(inputs.g, inputs.previews);
    let by_mesh = placement::primitives_by_mesh(inputs.primitives);
    // The largest scale each placed primitive is placed at, and the world extent of its placements.
    let mut scales: BTreeMap<usize, f64> = BTreeMap::new();
    let mut bounds = EMPTY_FLAT;
    for node_id in inputs.shown {
        let node = item(nodes, *node_id, "node")?;
        let old_mesh = required_index(node.get("mesh"), "node.mesh")?;
        let Some(mesh_index) = inputs.mesh_map.get(&old_mesh).copied() else {
            continue;
        };
        let Some(indices) = by_mesh.get(&(mesh_index as u64)) else {
            continue;
        };
        let matrix = &world[*node_id];
        // The world scale of the placement: the error a cut makes in its own units grows by it.
        let scale = longest_column(matrix);
        for index in indices.iter().copied() {
            let Some(cut) = inputs.cuts.get(index).filter(|cut| !cut.is_empty()) else {
                continue;
            };
            let slot = scales.entry(index).or_insert(0.0);
            if scale > *slot {
                *slot = scale;
            }
            let mut placed = [0.0; BOX_VALUES];
            box_transform(&mut placed, &bvh::extent(cut), matrix);
            grow_flat(&mut bounds, &placed);
        }
    }
    let mut meshes: Vec<CutColumns> = inputs
        .primitives
        .iter()
        .map(|_| CutColumns::default())
        .collect();
    let mut cell_metres = 0.0f64;
    for (index, scale) in &scales {
        let colour = palette.of(inputs.primitives[*index].get("material"));
        let columns = columns_of(inputs.cuts[*index].clone(), colour);
        cell_metres = cell_metres.max(columns.cell * scale);
        meshes[*index] = columns;
    }
    if bounds[0] > bounds[3] {
        bounds = [0.0; 6];
    }
    let cut_error = inputs
        .thresholds
        .iter()
        .copied()
        .fold(PROXY_ERROR_METRES, f64::max);
    Ok(SceneProxy {
        bounds,
        error_metres: cut_error + cell_metres * simplify::CELL_ERROR_FACTOR,
        cell_metres,
        meshes,
    })
}
