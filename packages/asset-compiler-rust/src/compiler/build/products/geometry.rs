//! The products of the source meshes' geometry (`../products.rs`): the voxels and
//! the distance fields of the meshes, the scene's lights and the indirect light baked from it.
use super::Products;
use crate::card_representation::{build_mesh_cards, CardInputs, PlacedCards};
use crate::compiler::primitive::compiled::DepthLayerScene;
use crate::distance_field::{build_mesh_fields, DistanceFieldInputs, Placed};
use crate::volumetric_lightmap::bake::SceneInputs;
use crate::volumetric_lightmap::{stage_volumetric_lightmap, LightmapInputs};
use crate::voxel::{stage_voxels, VoxelInputs, VoxelSettings};
use crate::*;

/// The voxels' file and manifest section, the meshes' distance fields and their cards.
type MeshProducts = ((Product, Value), Vec<Placed>, Vec<PlacedCards>);

/// The voxels of the source meshes, each sampled as its build says (`MeshBuild::voxels`): the file
/// and the manifest's section; the distance fields of the meshes whose build asks for one, and the
/// cards of those that keep some, which the HLOD cells' join once the world's actors are built, and
/// all are written together.
fn stage_mesh_products(
    inputs: &Products<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<MeshProducts> {
    let Products {
        pool,
        scene,
        directory,
        mesh_builds,
        primitives,
        voxel_seeds,
        texture_previews,
        ..
    } = *inputs;
    let DepthLayerScene {
        g, bin, mesh_map, ..
    } = *scene;
    let settings: Vec<VoxelSettings> = mesh_builds.iter().map(|build| build.voxels).collect();
    let voxel_inputs = VoxelInputs {
        g,
        bin,
        previews: texture_previews,
        mesh_map,
        primitives,
        seeds: voxel_seeds,
        settings: &settings,
    };
    let voxels = pool.install(|| stage_voxels(&voxel_inputs, directory, progress))?;
    let field_settings: Vec<_> = mesh_builds
        .iter()
        .map(|build| build.distance_field)
        .collect();
    let fields = DistanceFieldInputs {
        g,
        bin,
        previews: texture_previews,
        mesh_map,
        settings: &field_settings,
    };
    let distance = pool.install(|| build_mesh_fields(&fields))?;
    let card_settings: Vec<_> = mesh_builds.iter().map(|build| build.cards).collect();
    let cards = CardInputs {
        g,
        bin,
        previews: texture_previews,
        mesh_map,
        settings: &card_settings,
        fields: &field_settings,
        built: &distance,
        cache: &scene.o.cache,
        cancelled: &scene.o.cancelled,
    };
    let cards = pool.install(|| build_mesh_cards(&cards))?;
    Ok((voxels, distance, cards))
}

/// The scene's lights (their product), and the indirect light baked from its geometry and them: the
/// lightmap's file and section, none for a job that asks for no bake.
fn stage_lighting(
    inputs: &Products<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<(Product, Option<Product>, Option<Value>)> {
    let Products {
        scene,
        directory,
        scene_nodes,
        hidden,
        texture_previews,
        ..
    } = *inputs;
    let DepthLayerScene {
        o,
        g,
        bin,
        shown,
        placement,
        ..
    } = *scene;
    let (lights, declared) = stage_scene_lights(
        (g, &placement.world),
        (scene_nodes, hidden),
        directory,
        progress,
    )?;
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
    let (file, section) = stage_volumetric_lightmap(lightmap, directory, progress)?.unzip();
    Ok((lights, file, section))
}

/// What the source meshes' geometry gives the manifest: the voxels, the distance fields
/// and the cards of the meshes so far, the lights and the volumetric lightmap.
pub(super) struct Geometry {
    pub voxel_file: Product,
    pub voxels: Value,
    pub distance: Vec<Placed>,
    pub cards: Vec<PlacedCards>,
    pub lights: Product,
    pub lightmap_file: Option<Product>,
    pub volumetric_lightmap: Option<Value>,
}

/// The geometry's products staged, in the order of the module doc.
pub(super) fn stage_geometry(
    inputs: &Products<'_>,
    progress: &(impl Fn(Value) + Sync),
) -> Result<Geometry> {
    let ((voxel_file, voxels), distance, cards) = stage_mesh_products(inputs, progress)?;
    let (lights, lightmap_file, volumetric_lightmap) = stage_lighting(inputs, progress)?;
    Ok(Geometry {
        voxel_file,
        voxels,
        distance,
        cards,
        lights,
        lightmap_file,
        volumetric_lightmap,
    })
}
