#[cfg(test)]
pub(crate) mod preview;
use super::*;
/// Splits a finished manifest into the small JSON and the columns, as one page over every
/// primitive.
pub(super) fn split(m: &Value, pv: &[TexturePreview]) -> Result<(Value, Vec<u8>)> {
    split_pixels(m, pv).map(|(slim, bytes, _)| (slim, bytes))
}
/// `split`, with the previews' pixel file: the bytes the sidecar's pixel column no longer holds.
pub(super) fn split_pixels(m: &Value, pv: &[TexturePreview]) -> Result<(Value, Vec<u8>, Vec<u8>)> {
    let mut top = m.as_object().cloned().unwrap_or_default();
    let primitives = top.remove("primitives").unwrap_or_default();
    let primitives = primitives.as_array().map_or(&[][..], Vec::as_slice);
    let files = top.get("geometryFiles").and_then(Value::as_array);
    let encoded = Encoded::new(primitives, files.map_or(0, Vec::len))?;
    let page = encoded.page(&top, 0..primitives.len(), pv, true)?;
    Ok((page.json, page.sidecar, page.pixels))
}
/// The bytes of column `index` of a finished sidecar.
pub(super) fn column(bytes: &[u8], index: usize) -> &[u8] {
    digests::column(bytes, index).expect("a sidecar's column")
}
/// The word at `at` of `bytes`.
pub(super) fn word(bytes: &[u8], at: usize) -> u32 {
    crate::support::le::u32_at(bytes, at).expect("a word")
}
fn sha(c: char) -> String {
    std::iter::repeat_n(c, 64).collect()
}
fn exact_page() -> Value {
    let mut page = json!({"id":0,"count":12,"start":0,"min":[0.,0.,0.],"max":[1.,1.,1.],"role":"exact","level":0});
    page["lodError"] = json!(0.0);
    page["sphere"] = json!([0.5, 0.5, 0.5, 0.9]);
    page["parentError"] = json!(0.25);
    page["parentSphere"] = json!([1., 2., 3., 4.]);
    page["group"] = json!(0);
    page["source"] = Value::Null;
    page["stream"] = json!(0);
    page["streamOffset"] = json!(0);
    page["geometry"] = geometry();
    page
}
/// A page's geometry facts.
fn geometry() -> Value {
    json!({"bytes":32,"vertexCount":8,"indexCount":12,"flags":1,"uncompressedBytes":128,"residentBytes":40,"residentOffset":0})
}
fn coarse_page() -> Value {
    let mut page = json!({"id":1,"count":12,"start":0,"min":[0.,0.,0.],"max":[1.,1.,1.],"role":"coarse","level":1});
    page["lodError"] = json!(0.25);
    page["sphere"] = json!([0.5, 0.5, 0.5, 0.9]);
    page["parentError"] = Value::Null;
    page["parentSphere"] = Value::Null;
    page["group"] = Value::Null;
    page["source"] = json!(0);
    page["stream"] = json!(0);
    page["streamOffset"] = json!(32);
    page["geometry"] = geometry();
    page
}
pub(super) fn sample() -> Value {
    let mut primitive = json!({"mesh":0,"primitive":0,"pass":"exact-clusters"});
    primitive["culling"] = json!({"stride":trillion3d_page_codec::culling::CULLING_STRIDE,"count":1,"nodes":vec![0.5;trillion3d_page_codec::culling::CULLING_STRIDE]});
    primitive["structure"] = json!({"version":1,"roots":[1],"groups":[{"level":1,"error":0.25,"sphere":[1.,2.,3.,4.],"children":[0],"outputs":[1]}]});
    let mut bundle = json!({"file":0,"offset":0,"bytes":64,"count":2,"dependencies":[]});
    bundle["sha256"] = json!(sha('d'));
    primitive["streams"] = json!({"version":1,"pinned":1,"bundleBytes":131072,"dependencyBound":0,"maxDependencies":0,"pages":[bundle]});
    primitive["pages"] = json!([exact_page(), coarse_page()]);
    let file =
        json!({"url":format!("../../objects/{}.bin", sha('c')),"sha256":sha('c'),"bytes":64});
    json!({"formatVersion":2,"status":"ready","geometryFiles":[file],"primitives":[primitive]})
}
#[test]
fn columns_declare_their_own_offsets_and_lengths() {
    let (slim, bytes) = split(&sample(), &[]).expect("split");
    assert_eq!(word(&bytes, 0), MANIFEST_BINARY_MAGIC);
    assert_eq!(word(&bytes, 4), MANIFEST_BINARY_VERSION);
    assert_eq!(word(&bytes, 8), COLUMNS as u32);
    let read = |index: usize| {
        let at = (MANIFEST_BINARY_HEADER_WORDS + index * 2) * 4;
        (word(&bytes, at) as usize, word(&bytes, at + 4) as usize)
    };
    let mut previous = (MANIFEST_BINARY_HEADER_WORDS + COLUMNS * 2) * 4;
    for index in 0..COLUMNS {
        let (offset, length) = read(index);
        assert_eq!(offset % 8, 0, "column {index} is not eight-byte aligned");
        assert!(
            offset >= previous && offset + length <= bytes.len(),
            "column {index} is out of bounds"
        );
        previous = offset + length;
    }
    // Two pages, six bounds each, eight bytes a number.
    assert_eq!(read(PAGE_BOUNDS).1, 2 * 6 * 8);
    assert_eq!(read(GEOMETRY_U32).1, 2 * 7 * 4);
    assert_eq!(read(BUNDLE_SHA).1, 64);
    assert_eq!(
        read(CULLING_NODES).1,
        trillion3d_page_codec::culling::CULLING_STRIDE * 8
    );
    assert_eq!(read(GROUP_CHILD).1, 4);
    // The small JSON keeps the counts and loses the arrays.
    let primitive = slim["primitives"][0].as_object().unwrap();
    assert!(primitive.get("pages").is_none() && primitive.get("culling").is_none());
    assert_eq!(primitive["binary"]["pages"], json!(2));
    assert_eq!(primitive["binary"]["structure"]["groups"], json!(1));
    assert_eq!(primitive["binary"]["streams"]["pages"], json!(1));
    assert_eq!(slim["binary"]["bytes"], json!(bytes.len()));
}
#[test]
fn a_bundle_in_a_geometry_file_the_manifest_does_not_name_is_refused() {
    let mut manifest = sample();
    manifest["primitives"][0]["streams"]["pages"][0]["file"] = json!(1);
    let error = split(&manifest, &[]).unwrap_err();
    assert_eq!(error.code, "INVALID_MANIFEST");
    assert!(error.message.contains("geometry file"), "{error}");
}
// Behavior 10 (Rust): encoding refuses depthLayer exceeding four bits (> 15).
#[test]
fn split_rejects_a_depth_layer_that_exceeds_four_bits() {
    let mut manifest = sample();
    manifest["primitives"][0]["pages"][0]["depthLayer"] = json!(16);
    let error = split(&manifest, &[]).unwrap_err();
    assert_eq!(error.code, "INVALID_MANIFEST");
    assert!(
        error.message.contains("depthLayer"),
        "message must name the offending field: {}",
        error.message
    );
}
#[test]
fn split_accepts_a_depth_layer_at_the_four_bit_limit_and_writes_it_in_its_column() {
    let mut manifest = sample();
    manifest["primitives"][0]["pages"][0]["depthLayer"] = json!(15);
    let (_, bytes) = split(&manifest, &[]).expect("split");
    let layers = column(&bytes, PAGE_DEPTH_LAYER);
    assert_eq!(word(layers, 0), 15);
    // Second page (coarse_page) carries no depthLayer: column stays zero.
    assert_eq!(word(layers, 4), 0);
}
