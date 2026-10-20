//! From the requested layer to the intermediate scene written into the cache.
//!
//! The walk starts from `defaultPrim` when the layer names one — that is what the specification
//! calls the asset entry point — and from every root otherwise. A scene root carries the layer's
//! unit and up axis, so the rest of the hierarchy is written as-is.
use super::*;

/// Reads the layer and writes its conversion into the cache. Nothing is written beside the source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let file = single_input(request.inputs, NAME, ".usd, .usda or .usdc")?;
    let images = crate::plugins::scene::image_root(request.source);
    let stage = open(file)?;
    (request.progress)(
        json!({"phase":"import-source","step":"scan","plugin":NAME,"layers":stage.layer_count()}),
    );
    let mut scene = SceneTables::new(plugin);
    // Size and fingerprint from the one read pass, not a stat beside it.
    let (sha256, size) = crate::hash_file_sized(file)?;
    scene.read_source(file, usize::try_from(size).unwrap_or(usize::MAX), &sha256);
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

/// Opens the composed layer. An unreadable layer stops here, named, having written nothing.
fn open(file: &Path) -> Result<usd::Stage> {
    usd::Stage::open(&file.to_string_lossy()).map_err(|error| {
        CompilerError::new(
            "IMPORT_ERROR",
            format!("usd: {}: {error}", file.to_string_lossy()),
        )
    })
}

/// Walks the composed scene and fills the tables.
fn traverse(
    scene: &mut SceneTables,
    stage: &usd::Stage,
    images: &Path,
    request: &SceneRequest<'_>,
) {
    let mut world = World {
        stage,
        scene,
        images,
        root: fs::canonicalize(images).unwrap_or_else(|_| images.to_path_buf()),
        materials: HashMap::new(),
        meshes: HashMap::new(),
        cancelled: request.cancelled,
    };
    // The root carries the layer unit: a length read under it, such as a light's radius, is
    // put into metres by that same scale, and the walk takes it down with it.
    let unit = layer::meters_per_unit(stage);
    let children: Vec<usize> = roots(stage)
        .iter()
        .filter_map(|prim| visit::visit(&mut world, prim, 0, unit))
        .collect();
    let root = json!({
        "name": crate::plugins::scene::axes::ROOT_NAME,
        "matrix": crate::plugins::scene::axes::root(unit, layer::z_up(stage)),
        "children": children,
    });
    world.scene.node(root);
}

/// Prims the walk starts from: every scene root. `defaultPrim` names the asset entry point; it
/// subtracts nothing from the layer — it therefore goes first, and the other roots follow in the
/// order composition presents them.
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
