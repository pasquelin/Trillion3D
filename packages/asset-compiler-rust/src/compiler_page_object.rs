use super::*;

/// The geometry-page format the compiler writes, as `pages[].geometry` names it.
pub const GEOMETRY_PAGE_VERSION: u32 = web_geometry_page_codec::VERSION;
pub const GEOMETRY_PAGE_CODEC: &str = "quantized";

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
    position_exponent: i32,
) -> Result<(Value, bool)> {
    let page = geometry_page::encode(slice, pos, page_attributes, position_exponent)?;
    let data = page.bytes;
    let digest = hash(&data);
    let name = format!("../../objects/{}.bin", digest);
    let target = o
        .cache
        .join("native")
        .join("objects")
        .join(format!("{}.bin", digest));
    let reused = target.exists() && hash_file(&target)? == digest;
    if !reused {
        store_object(&target, &data)?;
    }
    Ok((
        json!({"url":name,"sha256":digest,"bytes":data.len(),"formatVersion":GEOMETRY_PAGE_VERSION,"codec":GEOMETRY_PAGE_CODEC,"vertexCount":page.vertex_count,"indexCount":slice.len(),"flags":page.flags,"uncompressedBytes":page.decoded_bytes,"quantizationError":page.quantization_error}),
        reused,
    ))
}

/// What the primitive's grid cost, for the manifest: the grid step and the largest position
/// displacement over every page, in object units; `null` on a primitive without pages.
pub(super) fn quantization_report(pages: &[Value], position_exponent: i32) -> Value {
    let worst = pages
        .iter()
        .filter_map(|page| page["geometry"]["quantizationError"].as_f64())
        .fold(None, |worst: Option<f64>, error| Some(worst.map_or(error, |w| w.max(error))));
    json!({
        "positionExponent": position_exponent,
        "positionStep": f64::from(web_geometry_page_codec::bits::pow2(position_exponent)),
        "uvExponent": crate::geometry_page_quant::UV_EXPONENT,
        "maxPositionError": worst,
    })
}
