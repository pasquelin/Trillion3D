//! The world's HLOD chains, each layer the parent of the one below: HLOD 0 is an instanced layer —
//! the source meshes themselves, batched: the placed objects' own pages, nothing to build —; each
//! layer above it builds its actors per cell of the level below (`compiler_tables/partition/
//! hlod.rs`): at HLOD 1 of the cell's objects, above it of the actors under it, approximated by a
//! closed shell or merged, given unique texture coordinates and the materials of the objects under
//! it baked into one atlas, a chain's top always loaded (`flatten.rs`, `world.rs`). Each actor is its own DAG; its
//! clusters wear its flattened material, a material of the published scene like any other, named
//! by the actor's rank (`dag_records.rs`, the scene tables' `hlodMaterials`). Each cluster names
//! its HLOD cell, whose switch shows it in place of the cells below once the view is far enough,
//! and its layer. Nothing is pinned: each HLOD cell holds its own roots' bundles (`pack.rs`). An
//! HLOD page is a `WGP3` page (`pages.rs`), drawn as any page.
//! An instance, its merge error and its cooking live in `cook`.
use super::*;
use crate::compiler_tables::partition::{CellMembers, HlodNode};
use crate::compiler_world::Mat4;
use crate::dag::DagStrategy;
use crate::proxy::placement::Placement;

#[cfg(test)]
mod attribute_tests;
mod cover;
#[cfg(test)]
mod culling_tests;
mod dag_records;
#[cfg(test)]
pub(crate) mod decoded;
pub(crate) mod flatten;
mod merge;
mod pack;
mod pages;
mod place;
mod records;
#[cfg(test)]
mod table_tests;
#[cfg(test)]
mod tests;
mod voxels;
mod world;
pub(crate) use cover::SourceCover;
mod cook;
pub(crate) use cook::{cook, merge_lod_error, Cooked, Instance};

/// Version of the world-roots products: 2 since their records, 3 since an object root names its
/// object by its table rank, 4 since a placed object is one level-0 cluster and a super-root a
/// `WGP3` page carrying its attributes, 5 since a cell names each node's first object, 6 since the
/// DAG lies in the order of the world's culling hierarchy and carries its nodes, 7 since a placed
/// object's record no longer lists its own roots' bundles, 8 since a placed object is written at
/// error 0 and every band and ceiling raised by the world grid's displacement, and a blended
/// primitive enters no world DAG, 9 since a placed object stands at its coarsest level and the
/// world's levels count on from it, 10 since the world is HLOD 1: one merged DAG per HLOD 0
/// cell from its objects' full geometry, each cluster naming its cell and layer, the table its
/// cells' bundles and nothing pinned, 11 since the chain runs HLOD 1 to HLOD 3, each table cell
/// naming its parent, layer and bounds, 12 since each actor above HLOD 0 wears its own flattened
/// material, a cluster naming its actor's rank in the scene tables' `hlodMaterials` where it named
/// the primitive whose material it wore, 13 since a merged layer's actor may wear a material of
/// the scene or another actor's flattened one, its rank in `hlodMaterials` naming it, and the
/// world's pages carry every attribute its actors carry, 14 since a cluster no longer names its HLOD
/// layer — its cell's level, which the table carries, gives it, 15 since each table cell's level
/// word carries in its high 16 bits whether its actor's build failed, so a failed top keeps its
/// content standing where a cell of objects in no layer follows its range alone, 16 since a
/// cluster of a voxel layer's actor holds a voxel page, flagged `GEOMETRY_VOXEL`, its triangles
/// its bricks' boxes', 17 since that page's head is six words, its bricks five — the rank of their
/// first voxel added —, its voxels twelve bytes (`trillion3d_page_codec::voxel`).
pub(crate) const WORLD_ROOTS_VERSION: u32 = 17;
/// The table a load reads: bundles, pages and HLOD cells, as records (`records.rs`).
pub(crate) const WORLD_ROOTS_FILE: &str = "world-roots.table";
/// The world clusters and groups the world stream reads on its first use, as records.
pub(crate) const WORLD_ROOTS_DAG: &str = "world-roots.dag";
/// The HLOD bundles, end to end: each bundle's range and digest is in the table.
pub(crate) const WORLD_ROOTS_BIN: &str = "world-roots.bin";

/// What the world stage hands back: its products, its report, the published scene with the
/// flattened materials and their glTF ranks, and their textures' chains.
pub(super) struct Staged {
    pub products: Vec<Product>,
    pub report: Value,
    pub materials: crate::compiler_tables::WorldMaterials,
    pub previews: Vec<crate::texture_preview::TexturePreview>,
}

/// Compilation stage: the HLOD layers of the objects the partition placed, `cells` naming the
/// published nodes of each cell, its HLOD 0 cell and the chain, `placement` their transforms and
/// the primitives of each mesh, computed once for the job; `source` the input scene, its binary
/// and its image root, whose materials the actors above HLOD 0 flatten. Written as
/// `world-roots.bin`, `world-roots.table` and `world-roots.dag`, an atlas image a PNG only where
/// its chain is not whole (`flatten::publish`); the report goes to the manifest, its measures to
/// the job's metrics. Exact clusters are never simplified, so no HLOD is built of them. The
/// builds run on the job's `pool`: its threads, its phase counters, in the job's RAM allowance
/// less the `reserved` bytes the geometry holds.
pub(super) fn stage_world_roots(
    (o, pool, reserved): (&Options, &rayon::ThreadPool, usize),
    (published, directory): (&Value, &Path),
    (primitives, covers, placement): (&[Value], Vec<SourceCover>, &Placement),
    cells: &CellMembers,
    source: (&Value, &[u8], &Path),
) -> Result<Staged> {
    let nothing = || Staged {
        products: Vec::new(),
        report: Value::Null,
        materials: None,
        previews: Vec::new(),
    };
    let hlod = o.hlod()?;
    // A job naming no HLOD builds no actor; neither does a job of exact clusters.
    if DagStrategy::named(&o.simplification) == DagStrategy::ExactClusters || hlod.layers.is_empty()
    {
        return Ok(nothing());
    }
    let Placement { world, by_mesh } = placement;
    let nodes = values(published, "nodes")?;
    let mut instances = Vec::new();
    // Only the objects in a layer: no other is decoded, estimated, approximated nor baked.
    let assigned = (cells.nodes.iter().zip(&cells.hlod))
        .filter(|&(_, &leaf)| cells.tree[leaf].layer.is_some());
    for (members, &hlod) in assigned {
        for &node in members {
            let mesh = nodes.get(node).and_then(|n| n["mesh"].as_u64());
            for &primitive in mesh.and_then(|m| by_mesh.get(&m)).into_iter().flatten() {
                instances.push(Instance {
                    hlod,
                    material: primitives[primitive]["material"].as_u64(),
                    matrix: world[node],
                    cover: &covers[primitive],
                });
            }
        }
    }
    if instances.iter().all(|i| i.cover.indices.is_empty()) {
        return Ok(nothing());
    }
    let materials: BTreeSet<Option<u64>> = instances.iter().map(|i| i.material).collect();
    let (cooked, actors) = pool.install(|| {
        let library = flatten::Library::new(source, &materials, (o, reserved))?;
        // The room is the job's allowance whole: the admission measures what the process holds,
        // the geometry `reserved` with it (`compiler_budget::admission::Room::Measured`).
        let builder = world::Builder {
            checkpoint: &|| check(o),
            library: &library,
            o,
            hlod,
            room: o.ram_budget_bytes(),
        };
        cook(&instances, &cells.tree, &builder)
    })?;
    let mut report = cooked.report;
    // Each object whose mark won over a rule naming another layer, and each node marked but not
    // placed: told, never an error.
    let name = |node: usize| {
        nodes
            .get(node)
            .and_then(|n| n["name"].as_str())
            .unwrap_or("")
    };
    let overruled = cells.overruled.iter().map(|&(node, layer, ruled)| {
        format!(
            "node {node} {}: its mark puts it in {}, over the rule naming {}",
            name(node),
            hlod.layers[layer].name,
            hlod.layers[ruled].name
        )
    });
    let unplaced = (cells.unplaced.iter()).map(|&node| {
        format!(
            "node {node} {}: marked, but animated, a parent or hidden: no HLOD takes it",
            name(node)
        )
    });
    report["assignmentWarnings"] = json!(overruled.chain(unplaced).collect::<Vec<_>>());
    let mut products = vec![
        product(directory, WORLD_ROOTS_BIN, &cooked.payload)?,
        product(directory, WORLD_ROOTS_FILE, &cooked.table)?,
        product(directory, WORLD_ROOTS_DAG, &cooked.dag)?,
    ];
    // The actors wearing their own flattened material, published; the others wear a material of
    // the scene or another actor's (`world::Wears`).
    let mut flattened: Vec<flatten::publish::Published> = Vec::new();
    let mut wears: Vec<Option<flatten::mesh_merge::Material>> = Vec::with_capacity(actors.len());
    for actor in actors {
        match actor.wears {
            world::Wears::Flattened(images) => {
                let level = cells.tree[actor.cell].actor_level();
                let name = format!("HLOD {level} cell {}", actor.cell);
                flattened.push(flatten::publish::Published { name, images });
                wears.push(None);
            }
            world::Wears::Merged(material) => wears.push(Some(material)),
        }
    }
    let name = |material: &flatten::publish::Published, image: &flatten::publish::Image| {
        format!(
            "{}-{}.png",
            material.name.replace(' ', "-").to_lowercase(),
            image.role.name()
        )
    };
    // Only an image whose chain lacks a level is written: a whole chain stands in for its source.
    for material in &flattened {
        for image in &material.images {
            if let Some(png) = &image.png {
                products.push(product(directory, &name(material, image), png)?);
            }
        }
    }
    let mut scene = published.clone();
    let (flat_ranks, previews) = flatten::publish::place(&mut scene, &mut flattened, &name);
    // Each actor's glTF material, by its rank: its own flattened one, the scene's it wears — glTF's
    // default material written out once for a source that names none —, or the one the actor it
    // names wears, made before it.
    let mut flat_ranks = flat_ranks.into_iter();
    let mut default = None;
    let mut ranks: Vec<usize> = Vec::with_capacity(wears.len());
    for worn in wears {
        let rank = match worn {
            None => flat_ranks.next().expect("a rank per flattened material"),
            Some(flatten::mesh_merge::Material::Source(Some(id))) => id as usize,
            Some(flatten::mesh_merge::Material::Source(None)) => {
                *default.get_or_insert_with(|| flatten::publish::default_material(&mut scene))
            }
            Some(flatten::mesh_merge::Material::Actor(k)) => ranks[k],
        };
        ranks.push(rank);
    }
    Ok(Staged {
        products,
        report,
        materials: Some((scene, ranks)),
        previews,
    })
}
