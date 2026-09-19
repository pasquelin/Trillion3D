//! From the requested scene to the intermediate scene written into the cache.
use super::*;

/// The requested scene. A directory that carries several scenes is an ambiguity: the compiler
/// does not choose in the caller's place, who names a specific `.unity` as the source.
fn scene_file(inputs: &[PathBuf]) -> Result<&Path> {
    let scenes: Vec<&PathBuf> = inputs
        .iter()
        .filter(|input| input.extension().is_some_and(|kind| kind == "unity"))
        .collect();
    match scenes.as_slice() {
        [one] => Ok(one.as_path()),
        [] => Err(CompilerError::new(
            "SOURCE_FORMAT_UNKNOWN",
            "unity: a .unity scene file is required beside the other Unity data files",
        )),
        many => {
            let names: Vec<String> = many
                .iter()
                .map(|scene| {
                    scene
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                })
                .collect();
            Err(CompilerError::new(
                "SOURCE_FORMAT_AMBIGUOUS",
                format!(
                    "unity: this directory carries {} scenes ({}); name the one to compile by giving its .unity file as the source",
                    names.len(),
                    names.join(", ")
                ),
            ))
        }
    }
}

/// Reads the scene and writes its conversion into the cache. Nothing is written beside the source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let file = scene_file(request.inputs)?;
    // Root under which the scene's image URIs resolve, the same as the one where the compiler
    // will reread those images: one rule for every driver.
    let source_dir = crate::plugins::scene::image_root(request.source);
    let project = Project::index(&assets_root(file), &source_dir, request.cancelled)?;
    (request.progress)(
        json!({"phase":"import-source","step":"scan","plugin":NAME,"metaFiles":project.meta_files}),
    );
    let mut scene = Scene::new(plugin);
    {
        let mut world = World {
            scene: &mut scene,
            project: &project,
            cache: request.cache,
            cancelled: request.cancelled,
            progress: request.progress,
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
