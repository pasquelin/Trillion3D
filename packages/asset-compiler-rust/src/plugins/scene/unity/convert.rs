//! From the requested scene to the intermediate scene written into the cache.
use super::*;

/// Reads the scene and writes its conversion into the cache. Nothing is written beside the source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let scenes = request.inputs.iter();
    let scenes: Vec<_> = scenes
        .filter(|input| input.extension().is_some_and(|kind| kind == "unity"))
        .collect();
    let file = *single_input(&scenes, NAME, ".unity scene")?;
    // Root under which the scene's image URIs resolve, the same as the one where the compiler
    // will reread those images: one rule for every driver.
    let source_dir = crate::plugins::scene::image_root(request.source);
    let project = Project::index(&assets_root(file), &source_dir, request.cancelled)?;
    (request.progress)(
        json!({"phase":"import-source","step":"scan","plugin":NAME,"metaFiles":project.meta_files}),
    );
    let mut scene = SceneTables::new(plugin);
    {
        let mut world = World {
            scene: &mut scene,
            project: &project,
            request,
        };
        traverse(&mut world, file)?;
        world.scene.count("metaFiles", project.meta_files);
    }
    // The key holds the digest of each data file read and that of each imported model: an
    // unchanged scene rewrites identically, in the same place.
    super::finish(
        scene,
        request,
        plugin,
        file,
        started,
        "unity: no visible mesh instance in this scene",
    )
}

/// Walks the scene from its roots.
fn traverse(world: &mut World<'_>, file: &Path) -> Result<()> {
    let mut builder = Builder {
        world,
        models: Models::default(),
        textures: Textures::default(),
        builtins: Builtins::default(),
        materials: HashMap::new(),
        documents: HashMap::new(),
        bound: HashMap::new(),
        claimed: HashSet::new(),
        pristine: HashMap::new(),
        placed: HashMap::new(),
    };
    let document = builder.document(file).ok_or_else(|| {
        CompilerError::new(
            "IMPORT_ERROR",
            format!(
                "unity: {} is not a readable Unity data file",
                file.display()
            ),
        )
    })?;
    let roots = Builder::roots(&document);
    if roots.is_empty() {
        return Err(CompilerError::new(
            "IMPORT_ERROR",
            format!(
                "unity: {} carries no root object; a truncated or empty scene is not compiled",
                file.display()
            ),
        ));
    }
    let (dropped, changes) = (HashSet::new(), Changes::default());
    for root in roots {
        builder.transform(&document, root, &dropped, &changes, 0);
    }
    Ok(())
}
