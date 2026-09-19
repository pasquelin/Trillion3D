//! The name of an image only designated, as it enters the intermediate scene.
use super::*;

/// A file name legal on disk and forbidden as-is in a URI.
const AWKWARD: &str = "co%lor #1 rouge.png";

// Behaviour: an image the file designates without carrying it is named by a URI, not by its
// path. `%`, `#` and space are escaped, or the consumer rereads another name, or nothing; and
// what is written decodes back exactly to what Blender had written.
#[test]
fn a_linked_image_is_named_by_an_escaped_uri() {
    let root = Path::new("/projet/scene");
    let declared = format!("//textures/{AWKWARD}");
    let uri = images::linked(&declared, root).expect("the image is under the served root");
    assert_eq!(uri, "textures/co%25lor%20%231%20rouge.png");
    assert_eq!(
        crate::uri::decode(&uri).as_deref(),
        Some(format!("textures/{AWKWARD}").as_str())
    );
}
