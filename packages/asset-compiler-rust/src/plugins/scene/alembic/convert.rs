//! De la source demandée à la scène intermédiaire écrite dans le cache.
use super::*;

/// Le fichier demandé. Un dossier qui porte plusieurs `.abc` est une ambiguïté : le compilateur ne
/// choisit pas à la place de l'appelant, qui lui désigne un fichier précis comme source.
fn source_file(inputs: &[PathBuf]) -> Result<&Path> {
    match inputs {
        [one] => Ok(one.as_path()),
        many => Err(CompilerError::new(
            "SOURCE_FORMAT_AMBIGUOUS",
            format!(
                "alembic: a source directory carries exactly one .abc, found {}",
                many.len()
            ),
        )),
    }
}

/// Lit l'archive et écrit sa conversion dans le cache. Rien n'est écrit à côté de la source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let file = source_file(request.inputs)?;
    let archive = Archive::open(file)?;
    let bytes = archive.file.bytes();
    (request.progress)(json!({"phase":"import-source","step":"scan","plugin":NAME,
        "bytes":bytes,"formatVersion":archive.file.version}));
    let mut scene = Scene::new(plugin);
    let name = file.file_name().unwrap_or_default().to_string_lossy();
    scene.read_file(&name, bytes, &hash_file(file)?);
    {
        let mut world = World {
            archive: &archive,
            scene: &mut scene,
            cancelled: request.cancelled,
        };
        let root = world.archive.root_object()?;
        for child in world.archive.children(&root)? {
            let attached = world.visit(&child, 0)?;
            world.scene.roots.extend(attached);
        }
    }
    // La clé tient l'empreinte du fichier lu : une archive inchangée se réécrit à l'identique, au
    // même endroit, et une archive modifiée n'hérite jamais de ce que la précédente avait écrit.
    super::finish(
        scene,
        request,
        plugin,
        file,
        started,
        &format!("alembic: {} carries no polygonal mesh", file.display()),
    )
}
