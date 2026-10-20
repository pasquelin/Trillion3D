//! A geometry page and its record: the attributes and deformation a primitive's pages carry, read
//! from the source, each page encoded, and the manifest record a runtime reads of it — its place,
//! a bundle and an offset there, joins it once its run is laid (`compiler_primitive_pages.rs`).
use super::*;
use crate::dag::DagCluster;
use trillion3d_page_codec::encode::deformation::{Deformation, MorphTarget};
use trillion3d_page_codec::encode::EncodeError;
impl From<EncodeError> for CompilerError {
    fn from(error: EncodeError) -> Self {
        Self::new(error.code, error.message)
    }
}
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
) -> Result<Vec<encode::Attribute>> {
    let mut attributes = Vec::new();
    for &(name, width, flag) in &encode::PAGE_ATTRIBUTES {
        let Some(id) = p
            .get("attributes")
            .and_then(Value::as_object)
            .and_then(|attributes| attributes.get(name))
        else {
            continue;
        };
        let widths = if name == "COLOR_0" {
            &[width, 3][..]
        } else {
            &[width]
        };
        let a = page_accessor((g, bin, validated), (id, name), count, widths)?;
        attributes.push(encode::Attribute {
            flag,
            width: a.width,
            values: a.collect_f32()?,
        });
    }
    Ok(attributes)
}
/// The accessor `id` of page attribute `name`, refused unless it holds the page's `count`
/// vertices, each of one of `widths` components.
fn page_accessor<'a>(
    (g, bin, validated): (&'a Value, &'a [u8], &BTreeSet<usize>),
    (id, name): (&Value, &str),
    count: usize,
    widths: &[usize],
) -> Result<Accessor<'a>> {
    let a = accessor(g, bin, required_index(Some(id), name)?, Some(validated))?;
    if a.count != count || !widths.contains(&a.width) {
        return Err(CompilerError::new(
            "INVALID_PAGE_ATTRIBUTE",
            format!("{name} count or width differs from POSITION"),
        ));
    }
    Ok(a)
}
#[path = "compiler_page_deform.rs"]
mod deform;
pub(super) use deform::page_deformation;
/// A geometry page as a primitive's pages take it: its `geometry` record, its bytes and the normal
/// cone of the triangles it draws, measured by the encoder on its decoded positions.
pub(crate) type EncodedPage = (Value, Vec<u8>, [f64; 4]);
/// Encodes a geometry page: its manifest entry, without its place, its bytes, which the
/// primitive's bundles carry to the geometry containers (`compiler_geometry_files.rs`), and its cone.
pub(super) fn encode_page(
    slice: &[u32],
    (pos, page_attributes): (&[f32], &[&encode::Attribute]),
    deformed: (&Deformation, &[u32]),
    (position_exponent, uv_exponent): (i32, i32),
) -> Result<EncodedPage> {
    let exponents = (position_exponent, uv_exponent);
    let encoded = encode::encode_deformed(slice, pos, page_attributes, deformed, exponents)?;
    let record = geometry_record(&encoded, slice.len());
    Ok((record, encoded.bytes, encoded.cone))
}
/// The `geometry` object of a page record: the packed page's facts. Where it lies is its page's
/// bundle (`stream`, `streamOffset`), whose digest proves it.
pub(crate) fn geometry_record(page: &encode::Encoded, indices: usize) -> Value {
    let header = &page.header;
    json!({"bytes":page.bytes.len(),"vertexCount":header.vertex_count,"indexCount":indices,"flags":header.flags,"uncompressedBytes":header.decoded_bytes(),"quantizationError":header.quantization_error})
}
/// The manifest record of the page at culling `rank`: its bounds and normal cone, and its packed
/// `geometry`, the one thing a runtime reads of it; its bundle joins it once packed.
/// `compiler_primitive::cost` charges each page by this shape.
pub(crate) fn page_record(
    (rank, cluster): (usize, &DagCluster),
    (min, max): ([f64; 3], [f64; 3]),
    [x, y, z, angle]: [f64; 4],
    geometry: Value,
) -> Value {
    let parent = |value: fn(&DagCluster) -> Value| match cluster.parent_error.is_finite() {
        true => value(cluster),
        false => Value::Null,
    };
    json!({"id":rank,"count":cluster.indices.len(),"start":cluster.source_rank as usize*3,"min":min,"max":max,
        "cone":{"axis":[x,y,z],"angle":angle},"role":if cluster.level==0{"exact"}else{"coarse"},
        "geometry":geometry,"level":cluster.level,"lodError":cluster.lod_error,"sphere":cluster.sphere,
        "parentError":parent(|c|json!(c.parent_error)),
        "parentSphere":parent(|c|json!(c.parent_sphere)),
        "group":cluster.group.map_or(Value::Null,|index|json!(index)),
        "source":cluster.source.map_or(Value::Null,|index|json!(index))})
}
/// What the primitive's grid cost, for the manifest: the grid exponents and the largest position
/// displacement over every page, in object units. Every primitive has pages
/// (`validate_cluster_errors`).
pub(super) fn quantization_report(
    pages: &[Value],
    position_exponent: i32,
    uv_exponent: i32,
) -> Value {
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
