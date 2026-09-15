//! De la scène demandée à la scène intermédiaire écrite dans le cache.
use super::*;

/// La scène demandée. Un dossier qui porte plusieurs scènes est une ambiguïté : le compilateur ne
/// choisit pas à la place de l'appelant, qui lui désigne un `.unity` précis comme source.
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

/// Lit la scène et écrit sa conversion dans le cache. Rien n'est écrit à côté de la source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let file = scene_file(request.inputs)?;
    let source_dir = if request.source.is_dir() {
        request.source.to_path_buf()
    } else {
        request
            .source
            .parent()
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
    };
    let project = Project::index(&assets_root(file), &source_dir, request.cancelled)?;
    (request.progress)(
        json!({"phase":"import-source","step":"scan","plugin":NAME,"metaFiles":project.meta_files}),
    );
    let mut scene = Scene::new(plugin);
    let counts = {
        let mut world = World {
            scene: &mut scene,
            project: &project,
            cache: request.cache,
            cancelled: request.cancelled,
            progress: request.progress,
        };
        traverse(&mut world, file)?;
        world.scene.count("metaFiles", project.meta_files);
        world.scene.counts.clone()
    };
    if request.cancelled.load(Ordering::Relaxed) {
        return Err(CompilerError::new("CANCELLED", "Import cancelled"));
    }
    if !scene.nodes.iter().any(|node| node.get("mesh").is_some()) {
        return Err(CompilerError::new(
            "IMPORT_EMPTY",
            "unity: no visible mesh instance in this scene",
        ));
    }
    // La clé tient l'empreinte de chaque fichier de données lu et celle de chaque modèle importé :
    // une scène inchangée se réécrit à l'identique, au même endroit.
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

/// Parcourt la scène depuis ses racines.
fn traverse(world: &mut World<'_>, file: &Path) -> Result<()> {
    let mut builder = Builder {
        world,
        models: Models::default(),
        textures: Textures::default(),
        builtins: Builtins::default(),
        materials: HashMap::new(),
        documents: HashMap::new(),
        bound: HashMap::new(),
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
    let (dropped, overrides) = (HashSet::new(), Overrides::new());
    for root in roots {
        builder.transform(&document, root, &dropped, &overrides, 0);
    }
    Ok(())
}
