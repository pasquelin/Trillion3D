use super::*;
use crate::dag::DagCluster;
use crate::geometry_page_deform::{Deformation, MorphTarget};
/// Geometry codec metadata; header magic and sidecar version gate every page.
pub fn geometry_page_format() -> Value {
    json!({"formatVersion":trillion3d_page_codec::VERSION,"codec":"quantized"})
}
/// Page attributes with `count` vertices and codec widths (RGB colour also accepted).
pub(super) fn page_attributes(
    g: &Value,
    bin: &[u8],
    p: &Value,
    count: usize,
    validated: &BTreeSet<usize>,
) -> Result<Vec<geometry_page::Attribute>> {
    let mut attributes = Vec::new();
    for &(name, width, flag) in &geometry_page::PAGE_ATTRIBUTES {
        let Some(id) = p
            .get("attributes")
            .and_then(Value::as_object)
            .and_then(|attributes| attributes.get(name))
        else {
            continue;
        };
        let a = accessor(g, bin, required_index(Some(id), name)?, Some(validated))?;
        if a.count != count || (a.width != width && !(name == "COLOR_0" && a.width == 3)) {
            return Err(CompilerError::new(
                "INVALID_PAGE_ATTRIBUTE",
                format!("{name} count or width differs from POSITION"),
            ));
        }
        attributes.push(geometry_page::Attribute {
            flag,
            width: a.width,
            values: a.collect_f32()?,
        });
    }
    Ok(attributes)
}
#[path = "compiler_page_deform.rs"]
mod deform;
pub(super) use deform::page_deformation;
/// Writes a geometry page into the content-addressed store and returns its
/// manifest entry.
///
/// A page already present whose fingerprint matches is not rewritten: two
/// compilations of the same source share their objects, and the reused-page
/// counter says so.
pub(super) fn store_page(
    o: &Options,
    slice: &[u32],
    (pos, page_attributes): (&[f32], &[&geometry_page::Attribute]),
    deformed: (&Deformation, &[u32]),
    (position_exponent, uv_exponent): (i32, i32),
) -> Result<(Value, bool)> {
    let exponents = (position_exponent, uv_exponent);
    let encoded = geometry_page::encode_deformed(slice, pos, page_attributes, deformed, exponents)?;
    let digest = hash(&encoded.bytes);
    let target = object_path(o, &digest);
    let reused = object_intact(&target, &digest)?.is_some();
    if !reused {
        store_object(&target, &encoded.bytes)?;
    }
    Ok((geometry_record(&digest, &encoded, slice.len()), reused))
}
/// The `geometry` object of a page record: the packed page stored under `digest`.
pub(crate) fn geometry_record(
    digest: &str,
    page: &geometry_page::Encoded,
    indices: usize,
) -> Value {
    let header = &page.header;
    json!({"url":format!("../../objects/{digest}.bin"),"sha256":digest,"bytes":page.bytes.len(),"vertexCount":header.vertex_count,"indexCount":indices,"flags":header.flags,"uncompressedBytes":header.decoded_bytes(),"quantizationError":header.quantization_error})
}
/// The manifest record of the page at culling `rank`: its index bytes stored under `digest` (their
/// `length`) at `offset` in bundle `stream`, their bounds and normal cone, and its packed
/// `geometry`. `compiler_primitive::cost` charges each page by this shape.
pub(crate) fn page_record(
    (rank, cluster): (usize, &DagCluster),
    (digest, length): (&str, usize),
    (min, max): ([f64; 3], [f64; 3]),
    [x, y, z, angle]: [f64; 4],
    geometry: Value,
    (stream, offset): (usize, usize),
) -> Value {
    let parent = |value: fn(&DagCluster) -> Value| match cluster.parent_error.is_finite() {
        true => value(cluster),
        false => Value::Null,
    };
    json!({"id":rank,"url":format!("../../objects/{digest}.bin"),"sha256":digest,"bytes":length,
        "count":cluster.indices.len(),"start":cluster.source_rank as usize*3,"min":min,"max":max,
        "cone":{"axis":[x,y,z],"angle":angle},"role":if cluster.level==0{"exact"}else{"coarse"},
        "geometry":geometry,"level":cluster.level,"lodError":cluster.lod_error,"sphere":cluster.sphere,
        "parentError":parent(|c|json!(c.parent_error)),
        "parentSphere":parent(|c|json!(c.parent_sphere)),
        "group":cluster.group.map_or(Value::Null,|index|json!(index)),
        "source":cluster.source.map_or(Value::Null,|index|json!(index)),
        "stream":stream,"streamOffset":offset})
}
/// What the primitive's grid cost, for the manifest: the grid exponents and the largest position
/// displacement over every page, in object units; `null` on a primitive without pages, which
/// was quantized on no grid.
pub(super) fn quantization_report(
    pages: &[Value],
    position_exponent: i32,
    uv_exponent: i32,
) -> Value {
    if pages.is_empty() {
        return Value::Null;
    }
    let worst = pages
        .iter()
        .filter_map(|page| page["geometry"]["quantizationError"].as_f64())
        .fold(None, |worst: Option<f64>, error| {
            Some(worst.map_or(error, |w| w.max(error)))
        });
    json!({
        "positionExponent": position_exponent,
        "uvExponent": uv_exponent,
        "maxPositionError": worst,
    })
}

#[cfg(test)]
#[path = "compiler_page_skin_tests.rs"]
mod skin_tests;
