//! From the requested file to the intermediate scene written into the cache.
//!
//! The file is read in full, then split into commands, then applied to a document, then converted.
//! Nothing is written beside the source: the scene goes under `request.cache`, at a key that holds
//! the digest of the bytes read, so an unchanged file rewrites identically in the same place and a
//! modified file never inherits what the previous one had written.
use super::*;

/// Reads the file and writes its conversion into the cache.
pub(super) fn convert(request: &SceneRequest<'_>, plugin: &dyn ScenePlugin) -> Result<PathBuf> {
    let started = Instant::now();
    let file = source_file(request.inputs)?;
    let bytes = usize::try_from(size(file)?).unwrap_or(usize::MAX);
    (request.progress)(json!({"phase":"import-source","step":"scan","plugin":NAME,"bytes":bytes}));
    let source = fs::read(file)?;
    let digest = crate::hash(&source);
    let mut document = document::read(&text(file, source)?)?;
    let graph = shading::resolve(&mut document);
    let mut scene = Scene::new(plugin);
    scene.read_file(
        &file.file_name().unwrap_or_default().to_string_lossy(),
        bytes,
        &digest,
    );
    carry(&document.report, &mut scene.report);
    build::scene(&document, &graph, &mut scene, request);
    super::finish(
        scene,
        request,
        plugin,
        file,
        started,
        &format!("ma: {} carries no visible polygonal mesh", file.display()),
    )
}

/// File size, rejected beyond the driver's ceiling rather than read.
fn size(file: &Path) -> Result<u64> {
    let bytes = fs::metadata(file)?.len();
    if bytes > MAX_BYTES {
        return Err(CompilerError::new(
            SIZE_UNSUPPORTED,
            format!(
                "ma: {} is {bytes} bytes, above the {MAX_BYTES} byte ceiling this reader admits",
                file.display()
            ),
        ));
    }
    Ok(bytes)
}

/// Text of the bytes read, already hashed. A file that is not UTF-8 is rejected by name: a `.ma`
/// is text, and guessing its encoding would change the names it carries.
fn text(file: &Path, bytes: Vec<u8>) -> Result<String> {
    String::from_utf8(bytes).map_err(|_| {
        CompilerError::new(
            FILE_INVALID,
            format!("ma: {} is not valid UTF-8 text", file.display()),
        )
    })
}

/// Pours the document-read report into the scene's: both stages count the same reasons, and the
/// manifest publishes only one table of them.
fn carry(from: &Report, into: &mut Report) {
    for (reason, count) in &from.unsupported {
        into.add_count(reason, *count);
    }
    into.notes.extend(from.notes.iter().cloned());
}
