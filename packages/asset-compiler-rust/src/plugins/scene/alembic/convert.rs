//! From the requested source to the intermediate scene written in the cache.
use super::*;

/// The requested file. A directory that holds several `.abc` is an ambiguity: the compiler does
/// not choose in the caller's place, who designates a precise file as the source.
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

/// Reads the archive and writes its conversion into the cache. Nothing is written next to the source.
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
    // The key holds the digest of the file read: an unchanged archive is rewritten identically, at
    // the same place, and a modified archive never inherits what the previous one had written.
    super::finish(
        scene,
        request,
        plugin,
        file,
        started,
        &format!("alembic: {} carries no polygonal mesh", file.display()),
    )
}
