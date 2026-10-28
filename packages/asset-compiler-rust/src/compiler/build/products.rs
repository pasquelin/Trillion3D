//! The cache products a job writes once its geometry and textures are in hand, in the order it
//! stages them: the voxels, the lights, the mesh pages, the node and
//! material tables, the world roots and the physics.
use super::*;
use crate::card_representation::{write_mesh_cards, PlacedCards};
use crate::compiler::args::mesh_build::MeshBuild;
use crate::compiler::pages::manifest::MeshPages;
use crate::compiler::primitive::compiled::DepthLayerScene;
use crate::compiler::source::assembly::plan::AssemblyParents;
use crate::distance_field::{write_distance_fields, Placed};
use crate::hlod::chain::SourceCover;
use crate::ray_tracing::{write_ray_tracing, PrimitiveTree};
use crate::texture::TexturePreview;
use crate::voxel::VoxelSeed;
use geometry::stage_geometry;

mod geometry;

/// What the products stage hands the manifest and its publication.
pub(super) struct Staged {
    /// The manifest's `voxels` section, its file among the products.
    pub voxels: Value,
    /// The manifest's `distanceFields` section, its file among the products; none for a scene
    /// whose meshes build no field (`distanceField`).
    pub distance_fields: Option<Value>,
    /// The manifest's `meshCards` section, its file among the products; none for a scene whose
    /// meshes keep no card (`maxMeshCards`).
    pub mesh_cards: Option<Value>,
    /// The manifest's `rayTracing` section, its file among the products; none when neither a
    /// primitive nor an HLOD actor of the scene has a triangle.
    pub ray_tracing: Option<Value>,
    /// The manifest's `volumetricLightmap` section, its file among the products; none for a job
    /// that asks for no bake (`lightmapBake`).
    pub volumetric_lightmap: Option<Value>,
    /// The manifest's `sparseVolumes` section, its file among the products; none for a scene whose
    /// nodes cite no volume.
    pub sparse_volumes: Option<Value>,
    /// Every product on disk in the folder, as its writer recorded it.
    pub products: Vec<Product>,
    pub paged: MeshPages,
    pub world_report: Value,
    pub physics: Value,
    /// The manifest's `animationBanks`, its file among the products; none for a scene whose
    /// objects play no item (`stage_scene_tables`).
    pub animation_banks: Option<Value>,
    /// The chains of the textures the world's flattened materials add (`hlod/chain.rs`).
    pub world_previews: Vec<TexturePreview>,
}

/// The node and material tables' product, the animation banks' with its descriptor, the published
/// scene they describe once the world's materials joined it, and the world's own products.
struct Tables {
    file: Product,
    banks: Option<(Product, Value)>,
    described: Option<Value>,
    world: crate::hlod::chain::Staged,
}

/// The tables staged, with the world's HLOD built once the partition's cells are known; the
/// materials it flattens join the published scene, which the tables and `source.gltf` describe.
/// `covers` are the primitives' roots (`Products::covers`), `paged` their pages.
fn stage_tables(
    inputs: &Products<'_>,
    (covers, paged): (Vec<SourceCover>, &MeshPages),
    progress: &(impl Fn(Value) + Sync),
) -> Result<Tables> {
    let Products {
        pool,
        scene,
        directory,
        image_root,
        reserved,
        primitives,
        source,
        assignments,
        parents,
        ..
    } = *inputs;
    let (o, g, bin) = (scene.o, scene.g, scene.bin);
    let (mesh_map, placement) = (scene.mesh_map, scene.placement);
    let mut world = None;
    let (file, banks, _, described) = stage_scene_tables(
        (
            g,
            bin,
            (
                o.hlod()?,
                assignments,
                o.partition_grid()?,
                o.object_settings()?,
            ),
            o.materials()?,
        ),
        (source, &placement.world, mesh_map, parents),
        paged,
        (directory, pool),
        progress,
        |cells| {
            let mut staged = stage_world_roots(
                (o, pool, reserved, progress),
                (source, directory),
                (primitives, covers, placement),
                cells,
                (g, bin, image_root),
            )?;
            let materials = staged.materials.take();
            world = Some(staged);
            Ok(materials)
        },
    )?;
    let world = world.expect("the tables build the world");
    Ok(Tables {
        file,
        banks,
        described,
        world,
    })
}

/// What the products are staged from: the job's pool and scene, where they are written, the compiled
/// primitives with what later stages read beside them, and the published scene.
pub(super) struct Products<'a> {
    pub pool: &'a rayon::ThreadPool,
    pub scene: &'a DepthLayerScene<'a>,
    pub directory: &'a Path,
    pub image_root: &'a Path,
    /// What the geometry already holds of the job's RAM allowance, as the textures are told
    /// (`TextureStage::reserved_bytes`).
    pub reserved: usize,
    pub mesh_builds: &'a [MeshBuild],
    pub primitives: &'a [Value],
    pub geometry_files: &'a [Value],
    pub collisions: &'a [Value],
    pub voxel_seeds: &'a [VoxelSeed],
    /// The tree of each primitive's coarse cut, in the primitives' order.
    pub ray_tracing: &'a [Option<PrimitiveTree>],
    pub texture_previews: &'a [TexturePreview],
    pub scene_nodes: &'a BTreeSet<usize>,
    pub hidden: &'a BTreeSet<usize>,
    pub source: &'a Value,
    pub assignments: &'a [Assigned],
    pub parents: &'a AssemblyParents,
}

/// Stages the products of `inputs` past its geometry: the source binary and scene, already
/// written, are listed after the tables; `covers` are the roots the primitives handed on;
/// `distance` the meshes' fields, built beside the textures.
pub(super) fn stage_products(
    inputs: &Products<'_>,
    distance: Vec<Placed>,
    covers: Vec<SourceCover>,
    (source_bin, source_gltf): (Product, Product),
    progress: &(impl Fn(Value) + Sync),
) -> Result<Staged> {
    let Products {
        pool,
        scene,
        directory,
        primitives,
        collisions,
        geometry_files,
        ..
    } = *inputs;
    let mut geometry = stage_geometry(inputs, distance, progress)?;
    let paged = write_mesh_pages(primitives, geometry_files.len(), directory)?;
    // Every mesh's field and cards stay in memory until the world's cells add theirs to the same
    // files: what the tables' stage (the world's HLOD build above all) is admitted with is the
    // allowance less what they hold.
    let held = (geometry
        .distance
        .iter()
        .map(Placed::held_bytes)
        .sum::<usize>())
    .saturating_add(
        geometry
            .cards
            .iter()
            .map(PlacedCards::held_bytes)
            .sum::<usize>(),
    );
    let tables_inputs = Products {
        reserved: inputs.reserved.saturating_add(held),
        ..*inputs
    };
    let tables = stage_tables(&tables_inputs, (covers, &paged), progress)?;
    let world = tables.world;
    geometry.distance.extend(world.fields);
    geometry.cards.extend(world.cards);
    let (distance_file, distance_fields) = pool
        .install(|| write_distance_fields(&geometry.distance, directory, progress))?
        .unzip();
    let (cards_file, mesh_cards) = pool
        .install(|| write_mesh_cards(&geometry.cards, directory, progress))?
        .unzip();
    let (tracing_file, ray_tracing) = write_ray_tracing(
        (inputs.ray_tracing, world.ray_tracing.as_ref()),
        directory,
        progress,
    )?
    .unzip();
    let source_gltf = match tables.described {
        Some(scene) => product(directory, "source.gltf", &serde_json::to_vec(&scene)?)?,
        None => source_gltf,
    };
    let (volumes_file, sparse_volumes) = crate::sparse_volume::write_sparse_volumes(
        &crate::sparse_volume::SparseVolumeInputs {
            g: scene.g,
            image_root: inputs.image_root,
            scene_nodes: inputs.scene_nodes,
            hidden: inputs.hidden,
        },
        directory,
        progress,
    )?
    .unzip();
    let (physics_file, physics) = stage_physics(scene, primitives, collisions, directory)?;
    let (banks_file, animation_banks) = tables.banks.unzip();
    let first = [tables.file, source_bin, source_gltf, geometry.lights];
    let mut products = Vec::from(first);
    products.extend([physics_file, geometry.voxel_file]);
    products.extend(distance_file);
    products.extend(cards_file);
    products.extend(tracing_file);
    products.extend(geometry.lightmap_file);
    products.extend(volumes_file);
    products.extend(geometry.profile_files);
    products.extend(banks_file);
    products.extend(world.products);
    Ok(Staged {
        voxels: geometry.voxels,
        distance_fields,
        mesh_cards,
        ray_tracing,
        volumetric_lightmap: geometry.volumetric_lightmap,
        sparse_volumes,
        products,
        paged,
        world_report: world.report,
        physics,
        animation_banks,
        world_previews: world.previews,
    })
}
