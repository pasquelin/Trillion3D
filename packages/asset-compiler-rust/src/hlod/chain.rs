//! The world's HLOD chains, each layer the parent of the one below. HLOD 0 is any layer's: an
//! instanced layer's is the source meshes themselves, the placed objects' own pages, nothing to
//! build; any other layer builds its HLOD 0 actor per main cell. Each layer above builds its
//! actors per cell of the grids below (`cells.rs`), every level of the cell's original objects —
//! every object under it, never an actor of a level below, its shape nor its texture —:
//! approximated by a closed shell or merged, given unique texture coordinates and baked into one
//! atlas of those objects' materials, voxelized, or instanced, each object its source mesh placed,
//! a chain's top always loaded or streamed on its last grid (`../flatten.rs`, `builds.rs`). Each
//! actor is its own mesh, a cluster DAG where its layer asks for one and its level 0 alone, drawn
//! whole, where it does not (`builds.rs`); its clusters
//! wear its flattened material, a material of the published scene like any other, named by the
//! actor's rank (`dag_records.rs`, the scene tables' `hlodMaterials`). Each cluster names
//! its HLOD cell, whose switch shows it in place of the cells below once the view is far enough,
//! and its layer. Nothing is pinned: each HLOD cell holds its own roots' pages (`bundles.rs`). An
//! HLOD page is a `WGP3` page (`pages.rs`), drawn as any page.
//! An instance, its merge screen size and its cooking live in `cook`.
use crate::compiler::source::node_transform::Mat4;
use crate::compiler::tables::partition::CellMembers;
use crate::proxy::placement::Placement;
use crate::*;

mod builds;
mod bundles;
pub(crate) mod cover;
mod dag_records;
mod instances;
pub(crate) mod merge;
mod pages;
pub(crate) mod place;
mod records;
#[cfg(test)]
pub(crate) mod tests;
mod traced;
pub(crate) mod voxels;
mod warnings;
pub(crate) use cover::SourceCover;
use warnings::assignment_warnings;
mod cook;
pub(crate) use cook::{cook, merged_lods, Cooked, Instance};

/// Version of the world-roots products; what each version changed is told in `docs/FORMAT.md`
/// (World HLOD).
pub(crate) const WORLD_ROOTS_VERSION: u32 = 37;
/// The table a load reads: bundles, pages and HLOD cells, as records (`records.rs`).
pub(crate) const WORLD_ROOTS_FILE: &str = "world-roots.table";
/// The world clusters and groups the world stream reads on its first use, as records.
pub(crate) const WORLD_ROOTS_DAG: &str = "world-roots.dag";
/// The HLOD bundles, end to end: each bundle's range and digest is in the table.
pub(crate) const WORLD_ROOTS_BIN: &str = "world-roots.bin";

/// What the world stage hands back: its products, its report, the published scene with the
/// flattened materials and their glTF ranks, their textures' chains, the distance field and the
/// cards of each HLOD cell whose layer allows a distance field (`allowDistanceField`), for the
/// distance field and the mesh cards stages to write, and the trees of the actors for ray tracing.
pub(crate) struct Staged {
    pub products: Vec<Product>,
    pub report: Value,
    pub materials: crate::compiler::tables::WorldMaterials,
    pub previews: Vec<crate::texture::TexturePreview>,
    pub fields: Vec<crate::distance_field::Placed>,
    pub cards: Vec<crate::card_representation::PlacedCards>,
    /// The world's trees for ray tracing, for the ray-tracing stage to write after the primitives'.
    pub ray_tracing: Option<crate::ray_tracing::WorldTrees>,
}

impl Staged {
    /// A stage that built nothing: a job naming no HLOD, or no object any layer takes.
    fn nothing() -> Self {
        Self {
            products: Vec::new(),
            report: Value::Null,
            materials: None,
            previews: Vec::new(),
            fields: Vec::new(),
            cards: Vec::new(),
            ray_tracing: None,
        }
    }
}

/// The distance field of each HLOD cell whose layer allows one, taken off its first actor
/// (`Actor::field`) before the actors go on to publish their materials.
fn take_fields(actors: &mut [builds::Actor]) -> Vec<crate::distance_field::Placed> {
    (actors.iter_mut())
        .filter_map(|actor| actor.field.take())
        .collect()
}

/// The cards of each HLOD cell whose layer allows a distance field, taken off its first actor
/// (`Actor::cards`) as its field is.
fn take_cards(actors: &mut [builds::Actor]) -> Vec<crate::card_representation::PlacedCards> {
    (actors.iter_mut())
        .filter_map(|actor| actor.cards.take())
        .collect()
}

/// Compilation stage: the HLOD layers of the objects the partition placed, `cells` naming the
/// published nodes of each cell, its HLOD 0 cell and the chain, `placement` their transforms and
/// the primitives of each mesh, computed once for the job; `source` the input scene, its binary
/// and its image root, whose materials the actors the layers build flatten. Written as
/// `world-roots.bin`, `world-roots.table` and `world-roots.dag`, an atlas image a PNG only where
/// its chain is not whole (`flatten::publish`); the report goes to the manifest, its measures to
/// the job's metrics. The builds run on the job's `pool`: its threads, its phase counters, in the
/// job's RAM allowance less the `reserved` bytes the geometry holds, each actor's job told to
/// `progress` as it ends.
pub(crate) fn stage_world_roots(
    (o, pool, reserved, progress): (&Options, &rayon::ThreadPool, usize, &(dyn Fn(Value) + Sync)),
    (published, directory): (&Value, &Path),
    (primitives, covers, placement): (&[Value], Vec<SourceCover>, &Placement),
    cells: &CellMembers,
    source: (&Value, &[u8], &Path),
) -> Result<Staged> {
    let hlod = o.hlod()?;
    // A job naming no HLOD builds no actor.
    if hlod.layers.is_empty() {
        return Ok(Staged::nothing());
    }
    let nodes = values(published, "nodes")?;
    let scene_materials = published["materials"]
        .as_array()
        .map_or(&[][..], Vec::as_slice);
    let instances = instances::gather(
        cells,
        (nodes, source.0),
        (primitives, &covers, placement),
        &fallbacks_of(published),
    )?;
    if instances.iter().all(|i| i.cover.indices.is_empty()) {
        return Ok(Staged::nothing());
    }
    let materials: BTreeSet<Option<u64>> = instances.iter().map(|i| i.material).collect();
    let (sky, _) = o.materials()?.sky_flags(source.0);
    let classes = crate::hlod::flatten::merge::classes(source.0, &materials, &sky);
    let (cooked, mut actors) = pool.install(|| {
        let library = crate::hlod::flatten::Library::new(source, &materials, (o, reserved))?;
        // Its chains on the device before any job starts, when a layer bakes: the admission then
        // measures them in what the process holds, never in a job's estimate.
        if hlod.layers.iter().any(crate::hlod::flatten::bakes) {
            library.pages()?;
        }
        // The room is the job's allowance whole: the admission measures what the process holds,
        // the geometry `reserved` with it (`compiler::budget::admission::Room::Measured`).
        let builder = builds::Builder {
            checkpoint: &|| check(o),
            progress,
            library: &library,
            classes: &classes,
            sky: &sky,
            o,
            hlod,
            room: o.ram_budget_bytes(),
        };
        cook(&instances, &cells.tree, (&builder, scene_materials))
    })?;
    let mut report = cooked.report;
    let ray_tracing = cooked.ray_tracing;
    let fields = take_fields(&mut actors);
    let cards = take_cards(&mut actors);
    report["actorFields"] = json!(fields.len());
    report["assignmentWarnings"] = json!(assignment_warnings(cells, hlod, nodes));
    let mut products = vec![
        product(directory, WORLD_ROOTS_BIN, &cooked.payload)?,
        product(directory, WORLD_ROOTS_FILE, &cooked.table)?,
        product(directory, WORLD_ROOTS_DAG, &cooked.dag)?,
    ];
    let (materials, previews) =
        published_materials(actors, (cells, published, directory), &mut products)?;
    Ok(Staged {
        products,
        report,
        materials: Some(materials),
        previews,
        fields,
        cards,
        ray_tracing,
    })
}

/// The fallback mesh of each mesh of the published scene that has one, by published rank.
fn fallbacks_of(published: &Value) -> BTreeMap<u64, u64> {
    let meshes = published["meshes"].as_array().into_iter().flatten();
    (meshes.enumerate())
        .filter_map(|(rank, mesh)| {
            let source = crate::compiler::source::fallback::of(mesh)?;
            Some((source as u64, rank as u64))
        })
        .collect()
}

/// The published scene with its flattened materials added and each actor's glTF material rank in
/// it, beside the textures' previews.
type PublishedMaterials = ((Value, Vec<usize>), Vec<crate::texture::TexturePreview>);

/// The scene `published` with the flattened materials of `actors` added, and each actor's glTF
/// material rank in it, with the textures' chains: an actor wearing its own flattened material has
/// it published (`products` gaining each image whose chain lacks a level: a whole chain stands in
/// for its source), the others wear a material of the scene (`builds::Wears`), glTF's default
/// material written out once for a source that names none.
fn published_materials(
    actors: Vec<builds::Actor>,
    (cells, published, directory): (&CellMembers, &Value, &Path),
    products: &mut Vec<Product>,
) -> Result<PublishedMaterials> {
    use crate::hlod::flatten::bake::publish::{self, Image, Published};
    // Per actor, `None` for its own material, else the scene's it wears — its glTF rank, `None`
    // for glTF's default.
    let mut flattened: Vec<Published> = Vec::new();
    let mut wears: Vec<Option<Option<u64>>> = Vec::with_capacity(actors.len());
    for actor in actors {
        match actor.wears {
            builds::Wears::Flattened {
                images,
                double_sided,
                sky,
            } => {
                let level = cells.tree[actor.cell].actor_level;
                let name = format!("HLOD {level} cell {}", actor.cell);
                flattened.push(Published {
                    name,
                    images,
                    double_sided,
                    sky,
                });
                wears.push(None);
            }
            builds::Wears::Merged(material) => wears.push(Some(material)),
        }
    }
    let name = |material: &Published, image: &Image| {
        format!(
            "{}-{}.png",
            material.name.replace(' ', "-").to_lowercase(),
            image.role.name()
        )
    };
    for material in &flattened {
        for image in &material.images {
            if let Some(png) = &image.png {
                products.push(product(directory, &name(material, image), png)?);
            }
        }
    }
    let mut scene = published.clone();
    let (flat_ranks, previews) = publish::place(&mut scene, &mut flattened, &name);
    // Each actor's glTF material, by its rank: its own flattened one, or the scene's it wears.
    let mut flat_ranks = flat_ranks.into_iter();
    let mut default = None;
    let mut ranks: Vec<usize> = Vec::with_capacity(wears.len());
    for worn in wears {
        let rank = match worn {
            None => flat_ranks.next().expect("a rank per flattened material"),
            Some(Some(id)) => id as usize,
            Some(None) => *default.get_or_insert_with(|| publish::default_material(&mut scene)),
        };
        ranks.push(rank);
    }
    Ok(((scene, ranks), previews))
}
