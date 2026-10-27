//! From the requested source to the intermediate scene written in the cache.
use super::*;

/// Reads the archive and writes its conversion into the cache. Nothing is written next to the source.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let file = single_input(request.inputs, NAME, ".abc")?;
    let archive = Archive::open(file)?;
    let bytes = archive.file.bytes();
    (request.progress)(json!({"phase":"import-source","step":"scan","plugin":NAME,
        "bytes":bytes,"formatVersion":archive.file.version}));
    let mut scene = Scene::new(plugin);
    scene
        .tables
        .read_source(file, bytes, &archive.file.sha256());
    {
        let mut world = World::new(&archive, &mut scene, request.cancelled);
        let root = archive.root_object()?;
        // What a top-level object attaches has no parent: the scene's roots, in walk order.
        for child in archive.children(&root)? {
            world.visit(&child, 0)?;
        }
    }
    // The key holds the digest of the file read: an unchanged archive is rewritten identically, at
    // the same place, and a modified archive never inherits what the previous one had written.
    super::finish(
        scene.tables,
        request,
        plugin,
        file,
        started,
        &format!(
            "alembic: {} carries neither a polygonal mesh nor curves",
            file.display()
        ),
    )
}
