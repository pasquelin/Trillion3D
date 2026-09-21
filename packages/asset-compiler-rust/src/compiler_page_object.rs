use super::*;

/// Writes a geometry page into the content-addressed store and returns its
/// manifest entry.
///
/// A page already present whose fingerprint matches is not rewritten: two
/// compilations of the same source share their objects, and the reused-page
/// counter says so.
pub(super) fn store_page(
    o: &Options,
    slice: &[u32],
    pos: &[f32],
    page_attributes: &[geometry_page::Attribute],
) -> Result<(Value, bool)> {
    let (data, flags, vertex_count) = geometry_page::encode(slice, pos, page_attributes)?;
    let digest = hash(&data);
    let name = format!("../../objects/{}.bin", digest);
    let target = object_path(o, &digest);
    let reused = object_intact(&target, &digest)?.is_some();
    if !reused {
        store_object(&target, &data)?;
    }
    Ok((
        json!({"url":name,"sha256":digest,"bytes":data.len(),"formatVersion":2,"codec":"meshopt","vertexCount":vertex_count,"indexCount":slice.len(),"flags":flags,"uncompressedBytes":vertex_count*geometry_page::STRIDE+slice.len()*2}),
        reused,
    ))
}
