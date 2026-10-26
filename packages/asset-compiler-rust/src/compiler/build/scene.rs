//! The scene a compile job works on before anything is built: its source loaded, its identical
//! meshes shared, the nodes it compiles picked, and the images they use read and answered.
use super::*;
use crate::compiler::args::mesh_build::MeshBuild;
use crate::compiler::source::mapped::RuntimeSource;
use crate::compiler::source::{mesh_share, nodes, select};
use crate::texture::source::ImageShas;
use std::borrow::Cow;

/// What every stage of a job reads: the options it runs on, its source, and what the stages before
/// it made of the source.
pub(super) struct Job<'a> {
    pub o: &'a Options,
    pub loaded: &'a RuntimeSource,
    pub bin: &'a [u8],
    pub image_root: &'a Path,
    pub key: &'a str,
    pub picked: &'a Picked,
    pub images: &'a Images,
    pub mesh_builds: &'a [MeshBuild],
}

/// The nodes the job compiles, and the meshes they place.
pub(super) struct Picked {
    /// The nodes whose mesh another node's mesh made identical (`share_identical_meshes`).
    pub shared_nodes: usize,
    /// The rendered scene's nodes, and the hidden ones: compiled (`chosen`), not drawn (`shown`).
    pub scene_nodes: BTreeSet<usize>,
    pub hidden: BTreeSet<usize>,
    pub chosen: BTreeSet<usize>,
    pub shown: BTreeSet<usize>,
    pub selected_triangles: usize,
    pub meshes: BTreeSet<usize>,
    pub mesh_map: BTreeMap<usize, usize>,
}

/// The images the compiled meshes' materials use: each taken once, for the key and the bake.
pub(super) struct Images {
    pub used_materials: BTreeSet<usize>,
    pub shas: ImageShas,
}

/// The options the job runs on: a scene a driver converted, or an archive extracted, has moved the
/// source onto its directory.
pub(super) fn rooted<'a>(o: &'a Options, scene: &PreparedScene) -> Cow<'a, Options> {
    match scene {
        PreparedScene::Converted { directory, .. } | PreparedScene::Extracted { directory, .. } => {
            Cow::Owned(Options {
                source: directory.clone(),
                ..o.clone()
            })
        }
        PreparedScene::Manifest | PreparedScene::InPlace(_) => Cow::Borrowed(o),
    }
}

/// The source of `scene` loaded, the assemblies the job allows laid out before anything reads the
/// meshes.
pub(super) fn load_scene(o: &Options, scene: &PreparedScene) -> Result<RuntimeSource> {
    let mut loaded = load_runtime(o, scene)?;
    crate::compiler::source::assembly::expand_assemblies(o, &mut loaded)?;
    Ok(loaded)
}

/// The identical meshes of `g` shared, a hierarchy that loops refused before any publication (the
/// world walk would never see it), and the nodes the job compiles picked.
pub(super) fn pick(o: &Options, g: &mut Value, bin: &[u8]) -> Result<Picked> {
    let shared_nodes = mesh_share::share_identical_meshes(g, bin);
    nodes::check_acyclic(g)?;
    let (scene_nodes, hidden) = nodes::scene_nodes(g)?;
    let select::NodeSelection {
        chosen,
        selected_triangles,
        meshes,
        mesh_map,
    } = select::select_nodes(o, g, &scene_nodes)?;
    // The fallback meshes an instanced layer without a cluster DAG stands its objects on join the
    // meshes compiled, after the others (`source/fallback.rs`).
    let mut meshes = meshes;
    let mut mesh_map = mesh_map;
    for fallback in crate::compiler::source::fallback::add(o, g, &chosen)?.into_values() {
        mesh_map.insert(fallback, meshes.len());
        meshes.insert(fallback);
    }
    let shown = chosen.difference(&hidden).copied().collect();
    Ok(Picked {
        shared_nodes,
        scene_nodes,
        hidden,
        chosen,
        shown,
        selected_triangles,
        meshes,
        mesh_map,
    })
}

/// The images the picked meshes use, fingerprinted on `pool`. Materials keep the blend mode the
/// source authored.
pub(super) fn read_images(
    pool: &rayon::ThreadPool,
    g: &Value,
    bin: &[u8],
    (picked, image_root): (&Picked, &Path),
) -> Result<Images> {
    let used_materials = crate::texture::collect::used_materials(g, &picked.meshes)?;
    let shas = pool.install(|| ImageShas::of(g, bin, image_root, &used_materials));
    Ok(Images {
        used_materials,
        shas,
    })
}
