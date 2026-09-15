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
    let counts = traverse(&mut scene, &stage, &images, request);
    if request.cancelled.load(Ordering::Relaxed) {
        return Err(CompilerError::new("CANCELLED", "Import cancelled"));
    }
    if !scene.nodes.iter().any(|node| node.get("mesh").is_some()) {
        return Err(CompilerError::new(
            "IMPORT_EMPTY",
            "usd: no visible mesh in this layer",
        ));
    }
    let directory = request
        .cache
        .join("native")
        .join("imports")
        .join(scene.key());
    let written = scene.write(plugin, &directory, file, started)?;
    (request.progress)(
        json!({"phase":"import-source","step":"complete","plugin":NAME,"counts":counts,"ms":started.elapsed().as_secs_f64()*1000.0}),
    );
    Ok(written)
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

/// Parcourt la scène composée et remplit les tables. Rend ce que le rapport publie en clair.
fn traverse(
    scene: &mut Scene,
    stage: &usd::Stage,
    images: &Path,
    request: &SceneRequest<'_>,
) -> BTreeMap<&'static str, usize> {
    let mut world = World {
        stage,
        scene,
        images,
        materials: HashMap::new(),
        meshes: HashMap::new(),
        images_by_uri: HashMap::new(),
        cancelled: request.cancelled,
    };
    let children: Vec<usize> = roots(stage)
        .iter()
        .filter_map(|prim| visit::visit(&mut world, prim, 0))
        .collect();
    let root = json!({
        "name": "usd-root",
        "matrix": matrix::root(layer::meters_per_unit(stage), layer::z_up(stage)),
        "children": children,
    });
    world.scene.node(root);
    world.scene.counts.clone()
}

/// Les prims par lesquels le parcours commence : le `defaultPrim` de la couche s'il en désigne un
/// qui existe, sinon toutes les racines de la scène.
fn roots(stage: &usd::Stage) -> Vec<usd::Prim> {
    let named = stage
        .default_prim()
        .and_then(|name| stage.prim(format!("/{}", name.as_str())).ok())
        .filter(|prim| prim.is_defined().unwrap_or(false));
    match named {
        Some(prim) => vec![prim],
        None => stage
            .prim("/")
            .map(|root| root.children().unwrap_or_default())
            .unwrap_or_default(),
    }
}
