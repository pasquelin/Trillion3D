//! De la couche demandée à la scène intermédiaire écrite dans le cache.
//!
//! Le parcours part du `defaultPrim` quand la couche en désigne un — c'est ce que la spécification
//! nomme le point d'entrée de l'asset — et de toutes les racines sinon. Une racine de scène porte
//! l'unité et l'axe haut de la couche, de sorte que le reste de la hiérarchie s'écrit tel quel.
use super::*;

/// Lit la couche et écrit sa conversion dans le cache. Rien n'est écrit à côté de la source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let file = super::source_file(request.inputs)?;
    let images = crate::plugins::scene::image_root(request.source);
    let stage = open(file)?;
    (request.progress)(
        json!({"phase":"import-source","step":"scan","plugin":NAME,"layers":stage.layer_count()}),
    );
    let mut scene = Scene::new(plugin);
    scene.read_file(
        &file.file_name().unwrap_or_default().to_string_lossy(),
        usize::try_from(fs::metadata(file)?.len()).unwrap_or(usize::MAX),
        &crate::hash_file(file)?,
    );
    traverse(&mut scene, &stage, &images, request);
    super::finish(
        scene,
        request,
        plugin,
        file,
        started,
        "usd: no visible mesh in this layer",
    )
}

/// Ouvre la couche composée. Une couche illisible s'arrête ici, nommée, sans rien avoir écrit.
fn open(file: &Path) -> Result<usd::Stage> {
    usd::Stage::open(&file.to_string_lossy()).map_err(|error| {
        CompilerError::new(
            "IMPORT_ERROR",
            format!("usd: {}: {error}", file.to_string_lossy()),
        )
    })
}

/// Parcourt la scène composée et remplit les tables.
fn traverse(scene: &mut Scene, stage: &usd::Stage, images: &Path, request: &SceneRequest<'_>) {
    let mut world = World {
        stage,
        scene,
        images,
        root: fs::canonicalize(images).unwrap_or_else(|_| images.to_path_buf()),
        materials: HashMap::new(),
        meshes: HashMap::new(),
        cancelled: request.cancelled,
    };
    // La racine porte l'unité de la couche : une longueur lue sous elle, comme le rayon d'une
    // lampe, se met en mètres par cette même échelle, et le parcours la descend avec lui.
    let unit = layer::meters_per_unit(stage);
    let children: Vec<usize> = roots(stage)
        .iter()
        .filter_map(|prim| visit::visit(&mut world, prim, 0, unit))
        .collect();
    let root = json!({
        "name": "usd-root",
        "matrix": matrix::root(unit, layer::z_up(stage)),
        "children": children,
    });
    world.scene.node(root);
}

/// Les prims par lesquels le parcours commence : toutes les racines de la scène. `defaultPrim`
/// nomme le point d'entrée de l'asset, il ne retranche rien de la couche — il passe donc en tête,
/// et les autres racines suivent dans l'ordre où la composition les présente.
fn roots(stage: &usd::Stage) -> Vec<usd::Prim> {
    let mut roots = stage
        .prim("/")
        .map(|root| root.children().unwrap_or_default())
        .unwrap_or_default();
    let named = stage.default_prim().map(|name| name.as_str().to_string());
    let first = named.and_then(|name| {
        roots
            .iter()
            .position(|prim| prim.path().name() == Some(name.as_str()))
    });
    if let Some(rank) = first {
        roots[..=rank].rotate_right(1);
    }
    roots
}
