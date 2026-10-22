//! The cache products a job writes once its geometry and textures are in hand, in the order it
//! stages them: the resident proxy, the voxels, the lights, the mesh pages, the node and
//! material tables, the world roots and the physics.
use super::*;
use crate::compiler::pages::manifest::MeshPages;
use crate::compiler::primitive::compiled::DepthLayerScene;
use crate::distance_field::{stage_distance_fields, DistanceFieldInputs};
use crate::hlod::chain::SourceCover;
use crate::texture::TexturePreview;
use crate::volumetric_lightmap::bake::SceneInputs;
use crate::volumetric_lightmap::{stage_volumetric_lightmap, LightmapInputs};
use crate::voxel::{stage_voxels, VoxelInputs, VoxelSampling, VoxelSeed};

/// What the products stage hands the manifest and its publication.
pub(super) struct Staged {
    /// The proxy as its own cache object, its digest, and the descriptor the manifest carries.
    pub proxy_bytes: Vec<u8>,
    pub proxy_sha: String,
    pub proxy_descriptor: Value,
    /// The manifest's `voxels` section, its file among the products.
    pub voxels: Value,
    /// The manifest's `distanceFields` section, its file among the products; none for a scene
    /// whose meshes build no field (`distanceField`).
    pub distance_fields: Option<Value>,
    /// The manifest's `volumetricLightmap` section, its file among the products; none for a job
    /// that asks for no bake (`lightmapBake`).
    pub volumetric_lightmap: Option<Value>,
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

/// Stages the products of `scene` past its geometry: the source binary and scene, already
/// written, are listed after the tables; `reserved` is what the geometry already holds of the
/// job's RAM allowance, as the textures are told (`TextureStage::reserved_bytes`).
pub(super) fn stage_products(
    (pool, scene, directory, image_root, reserved): (
        &rayon::ThreadPool,
        &DepthLayerScene<'_>,
        &Path,
        &Path,
        usize,
    ),
    (voxel_seeds, mesh_scales): (&[VoxelSeed], &BTreeMap<usize, f64>),
    (primitives, geometry_files, covers, collisions): (
        &[Value],
        &[Value],
        Vec<SourceCover>,
        &[Value],
    ),
    (proxy_cuts, proxy_thresholds, texture_previews): (&[Vec<f32>], &[f64], &[TexturePreview]),
    (scene_nodes, hidden, source, assignments): (
        &BTreeSet<usize>,
        &BTreeSet<usize>,
        &Value,
        &[Assigned],
    ),
    (source_bin, source_gltf): (Product, Product),
    progress: &(impl Fn(Value) + Sync),
) -> Result<Staged> {
    let DepthLayerScene {
        o,
        g,
        bin,
        shown,
        mesh_map,
        placement,
        ..
    } = *scene;
    // The resident proxy: coarse cuts and previews in hand, node hierarchy still there.
    let scene_proxy = {
        let _t = crate::support::perf::Timer::new(crate::support::perf::Phase::Manifest);
        proxy::stage_proxy(&proxy::ProxyInputs {
            g,
            shown,
            mesh_map,
            mesh_scales,
            primitives,
            placement,
            cuts: proxy_cuts,
            thresholds: proxy_thresholds,
            previews: texture_previews,
        })?
    };
    progress(
        json!({"phase":"proxy","completed":1,"total":1,"triangles":scene_proxy.triangle_count(),
        "nodes":scene_proxy.node_count(),"errorMetres":scene_proxy.error_metres}),
    );
    // How each source mesh's voxels are sampled: its build's.
    let sampling: Vec<VoxelSampling> = (o.mesh_build()?.meshes(g)?.iter())
        .map(|build| build.voxels)
        .collect();
    let voxel_inputs = VoxelInputs {
        g,
        bin,
        previews: texture_previews,
        mesh_map,
        primitives,
        seeds: voxel_seeds,
        sampling: &sampling,
    };
    let (voxel_file, voxels) = pool.install(|| stage_voxels(&voxel_inputs, directory, progress))?;
    // The meshes' distance fields, for the meshes whose build asks for one.
    let fields = DistanceFieldInputs {
        g,
        bin,
        previews: texture_previews,
        mesh_map,
        settings: &(o.mesh_build()?.meshes(g)?.iter())
            .map(|build| build.distance_field)
            .collect::<Vec<_>>(),
    };
    let (distance_file, distance_fields) = pool
        .install(|| stage_distance_fields(&fields, directory, progress))?
        .unzip();
    // The proxy is its own cache object: a manifest stays readable without its tens of megabytes.
    let proxy_bytes = scene_proxy.encode();
    let proxy_sha = hash(&proxy_bytes);
    let proxy_descriptor =
        scene_proxy.descriptor(proxy::SCENE_PROXY_FILE, &proxy_sha, proxy_bytes.len());
    // Cache products, each under its own name: lights, node and material tables, physics.
    let (lights, declared) = stage_scene_lights(
        (g, bin, &placement.world),
        (scene_nodes, hidden),
        directory,
        progress,
    )?;
    // The scene's indirect light, baked from its geometry and its lights.
    let lightmap = LightmapInputs {
        options: o.lightmap_bake()?,
        scene: SceneInputs {
            g,
            bin,
            world: &placement.world,
            shown,
            previews: texture_previews,
        },
        lights: &declared,
        cancelled: &o.cancelled,
    };
    let (lightmap_file, volumetric_lightmap) =
        stage_volumetric_lightmap(lightmap, directory, progress)?.unzip();
    let paged = write_mesh_pages(primitives, geometry_files.len(), directory)?;
    // The world's HLOD is built once the partition's cells are known; the materials it flattens
    // join the published scene, which the tables and `source.gltf` then describe.
    let mut world = None;
    let (tables, banks, _, described) = stage_scene_tables(
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
        (source, &placement.world, mesh_map),
        &paged,
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
    let source_gltf = match described {
        Some(scene) => product(directory, "source.gltf", &serde_json::to_vec(&scene)?)?,
        None => source_gltf,
    };
    let (physics_file, physics) = stage_physics(scene, primitives, collisions, directory)?;
    let mut products = vec![
        tables,
        source_bin,
        source_gltf,
        lights,
        physics_file,
        voxel_file,
    ];
    products.extend(distance_file);
    products.extend(lightmap_file);
    let (banks_file, animation_banks) = banks.unzip();
    products.extend(banks_file);
    products.extend(world.products);
    Ok(Staged {
        proxy_bytes,
        proxy_sha,
        proxy_descriptor,
        voxels,
        distance_fields,
        volumetric_lightmap,
        products,
        paged,
        world_report: world.report,
        physics,
        animation_banks,
        world_previews: world.previews,
    })
}
