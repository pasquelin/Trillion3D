use super::*;

fn inputs<'a>(
    o: &'a Options,
    g: &'a Value,
    bin: &'a [u8],
    source_dir: &'a Path,
    meshes: &'a BTreeSet<usize>,
    view_map: &'a BTreeMap<usize, usize>,
) -> PreviewInputs<'a> {
    PreviewInputs {
        o,
        g,
        bin,
        source_dir,
        meshes,
        view_map,
    }
}

// Comportement 6 (a) : une uri encodée (`%20`) est décodée puis lue sous le dossier source.
#[test]
fn a_uri_with_percent_20_is_decoded_before_reading() {
    let dir = temp_dir("uri-space");
    fs::write(dir.join("my image.png"), b"bytes-of-my-image").expect("write");
    let (o, g, bin, meshes, view_map) = (
        options(&dir),
        json!({}),
        Vec::new(),
        BTreeSet::new(),
        BTreeMap::new(),
    );
    let image = json!({"uri": "my%20image.png"});
    let (bytes, provenance) = crate::texture_preview::source::image_bytes(
        &inputs(&o, &g, &bin, &dir, &meshes, &view_map),
        &image,
    )
    .expect("read");
    assert_eq!(bytes, b"bytes-of-my-image");
    assert!(provenance == PreviewSource::Uri);
}

// Comportement 6 (b) : une uri qui tente de sortir du dossier source (`..`) est refusée.
#[test]
fn a_uri_with_dot_dot_is_refused() {
    let dir = temp_dir("uri-dotdot");
    let (o, g, bin, meshes, view_map) = (
        options(&dir),
        json!({}),
        Vec::new(),
        BTreeSet::new(),
        BTreeMap::new(),
    );
    let image = json!({"uri": "../secret.png"});
    let error = crate::texture_preview::source::image_bytes(
        &inputs(&o, &g, &bin, &dir, &meshes, &view_map),
        &image,
    )
    .err()
    .expect("expected error");
    assert_eq!(error, "image-uri-outside-source");
}

// Comportement 6 (c) : une image embarquée nomme sa vue de tampon telle que `source.gltf` la
// publie — celle de `view_map`, pas l'index de la vue d'entrée.
#[test]
fn an_embedded_image_names_its_remapped_buffer_view() {
    let dir = temp_dir("buffer-view");
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

// Comportement 6 (d) : une uri `data:` est refusée — l'aperçu ne décode jamais un base64 embarqué.
#[test]
fn a_data_uri_is_refused() {
    let dir = temp_dir("uri-data");
    let (o, g, bin, meshes, view_map) = (
        options(&dir),
        json!({}),
        Vec::new(),
        BTreeSet::new(),
        BTreeMap::new(),
    );
    let image = json!({"uri": "data:image/png;base64,AAAA"});
    let error = crate::texture_preview::source::image_bytes(
        &inputs(&o, &g, &bin, &dir, &meshes, &view_map),
        &image,
    )
    .err()
    .expect("expected error");
    assert_eq!(error, "image-uri-not-relative");
}
