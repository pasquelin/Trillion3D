use super::*;

/// No textures to measure: tests cover previews only.
static RIEN_A_MESURER: BTreeSet<usize> = BTreeSet::new();

fn inputs<'a>(
    o: &'a Options,
    g: &'a Value,
    bin: &'a [u8],
    image_root: &'a Path,
    meshes: &'a BTreeSet<usize>,
    view_map: &'a BTreeMap<usize, usize>,
) -> PreviewInputs<'a> {
    PreviewInputs {
        o,
        reserved_bytes: 0,
        g,
        bin,
        image_root,
        meshes,
        view_map,
        to_measure: &RIEN_A_MESURER,
        measurements: crate::cutout::MeasureCache::EMPTY,
    }
}

/// What reading the image at `uri` under `dir` gives, the scene carrying nothing else.
fn read_uri(dir: &Path, uri: &str) -> std::result::Result<(Vec<u8>, PreviewSource), &'static str> {
    let (o, g, bin, meshes, view_map) = (
        options(dir),
        json!({}),
        Vec::new(),
        BTreeSet::new(),
        BTreeMap::new(),
    );
    crate::texture_preview::source::image_bytes(
        &inputs(&o, &g, &bin, dir, &meshes, &view_map),
        &json!({"uri": uri}),
    )
}

// Behavior 6 (a): encoded URI (`%20`) decoded then read under source folder.
#[test]
fn a_uri_with_percent_20_is_decoded_before_reading() {
    let dir = scratch("texture-preview", "uri-space");
    fs::write(dir.join("my image.png"), b"bytes-of-my-image").expect("write");
    let (bytes, provenance) = read_uri(&dir, "my%20image.png").expect("read");
    assert_eq!(bytes, b"bytes-of-my-image");
    assert!(provenance == PreviewSource::Uri);
}

// Behavior 6 (b): URI attempting path traversal out of source (`..`) refused.
#[test]
fn a_uri_with_dot_dot_is_refused() {
    let dir = scratch("texture-preview", "uri-dotdot");
    let error = read_uri(&dir, "../secret.png")
        .err()
        .expect("expected error");
    assert_eq!(error, "image-uri-outside-source");
}

// Behavior 6 (c): embedded image names buffer view as `source.gltf`
// publishes it — `view_map`, not input view index.
#[test]
fn an_embedded_image_names_its_remapped_buffer_view() {
    let dir = scratch("texture-preview", "buffer-view");
    let bin = vec![0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    let g = json!({"bufferViews": [{"byteOffset": 2, "byteLength": 4}]});
    let o = options(&dir);
    let meshes = BTreeSet::new();
    let view_map = BTreeMap::from([(0usize, 7usize)]);
    let image = json!({"bufferView": 0});
    let (bytes, provenance) = crate::texture_preview::source::image_bytes(
        &inputs(&o, &g, &bin, &dir, &meshes, &view_map),
        &image,
    )
    .expect("read");
    assert_eq!(bytes, vec![2, 3, 4, 5]);
    assert!(matches!(provenance, PreviewSource::BufferView(7)));
}

// Behavior 6 (d): `data:` URI refused — preview never decodes embedded base64.
#[test]
fn a_data_uri_is_refused() {
    let dir = scratch("texture-preview", "uri-data");
    let error = read_uri(&dir, "data:image/png;base64,AAAA")
        .err()
        .expect("expected error");
    assert_eq!(error, "image-uri-not-relative");
}
