//! What only the driver's interior can prove: the name a project asset carries in the
//! intermediate scene. What the driver produces from a real project is proven in `src/tests/`.
use super::*;

/// A filename legal on disk and forbidden as-is in a URI.
const AWKWARD: &str = "co%lor #1 rouge.png";
/// The GUID this image's `.meta` declares.
const GUID: &str = "00000000000000000000000000000001";

// Behaviour: a project texture is named by a URI, not by its path. `%`, `#` and space are
// escaped, otherwise the engine would request another file, or none; and what is written
// re-decodes exactly to what the author named.
#[test]
fn a_project_asset_is_named_by_an_escaped_uri() {
    let root = std::env::temp_dir().join(format!(
        "trillion3d-unity-uri-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ));
    let assets = root.join("Assets").join("Textures");
    fs::create_dir_all(&assets).expect("directory");
    let image = assets.join(AWKWARD);
    fs::write(&image, b"\x89PNG\r\n\x1a\n").expect("image");
    fs::write(
        project::meta_of(&image),
        format!("fileFormatVersion: 2\nguid: {GUID}\n"),
    )
    .expect("meta");
    let source = root.join("Assets");
    let project = Project::index(&source, &source, &AtomicBool::new(false)).expect("project");
    let asset = project.asset(GUID).expect("the image is indexed");
    let uri = project.relative_uri(asset).expect("it is under the root");
    assert_eq!(uri, "Textures/co%25lor%20%231%20rouge.png");
    assert_eq!(
        crate::uri::decode(&uri).as_deref(),
        Some(format!("Textures/{AWKWARD}").as_str())
    );
    fs::remove_dir_all(&root).expect("cleanup");
}
