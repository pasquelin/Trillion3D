//! A geometry page and its record: the attributes and deformation a primitive's pages carry, read
//! from the source, each page encoded, and the manifest record a runtime reads of it — its place,
//! a bundle and an offset there, joins it once its run is laid (`../primitive/pages.rs`).
pub(crate) mod deform;
#[cfg(test)]
pub(crate) mod tests;
use crate::dag::DagCluster;
use crate::*;
use trillion3d_page_codec::bits::grid::PageGrid;
pub(crate) use trillion3d_page_codec::encode::deformation::{Deformation, MorphTarget};
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
/// What a primitive's page attributes take beside its accessors (`page_attributes`).
#[derive(Clone, Copy)]
pub(crate) struct PageSource {
    /// The vertices of its `POSITION`.
    pub count: usize,
    pub stored_tangents: bool,
    pub made_normals: bool,
    pub mesh_tangents: bool,
}
/// Page attributes with `count` vertices and codec widths (RGB colour also accepted). A primitive
/// without `NORMAL` carries normals all nothing when its build rebuilds every normal
/// (`made_normals`), which the build then lays (`dag/input/frames.rs`); the `TANGENT` too when the
/// mesh stores its tangents (`stored_tangents`, `encode::TANGENT_ATTRIBUTE`) and the primitive has
/// its normals, which a stored tangent turns around. A primitive with no `TANGENT` of its own
/// takes +X, its sign 1, when it has its `NORMAL` and another primitive of its mesh has a
/// `TANGENT` (`mesh_tangents`), as a mesh's reader fills the gap; else all nothing, which the
/// build lays.
pub(crate) fn page_attributes(
    g: &Value,
    bin: &[u8],
    p: &Value,
    PageSource {
        count,
        stored_tangents,
        made_normals,
        mesh_tangents,
    }: PageSource,
    validated: &BTreeSet<usize>,
) -> Result<Vec<encode::Attribute>> {
    let mut attributes = Vec::new();
    let named = p.get("attributes").and_then(Value::as_object);
    let has_normals = named.is_some_and(|named| named.contains_key("NORMAL"));
    let tangent =
        (stored_tangents && (has_normals || made_normals)).then_some(encode::TANGENT_ATTRIBUTE);
    for &(name, width, flag) in encode::PAGE_ATTRIBUTES.iter().chain(&tangent) {
        let Some(id) = named.and_then(|named| named.get(name)) else {
            let values = match (flag == encode::TANGENT_ATTRIBUTE.2, name == "NORMAL") {
                (true, _) if has_normals && mesh_tangents => [1.0, 0.0, 0.0, 1.0].repeat(count),
                (true, _) => vec![0.0; count * width],
                (_, true) if made_normals => vec![0.0; count * width],
                _ => continue,
            };
            attributes.push(encode::Attribute {
                flag,
                width,
                values,
            });
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
pub(crate) fn page_accessor<'a>(
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
pub(crate) use crate::compiler::pages::record::deform::page_deformation;
/// A geometry page as a primitive's pages take it: its `geometry` record and its bytes.
pub(crate) type EncodedPage = (Value, Vec<u8>);
/// Encodes a geometry page: its manifest entry, without its place, and its bytes, which the
/// primitive's bundles carry to the geometry containers (`containers.rs`).
pub(crate) fn encode_page(
    slice: &[u32],
    (pos, page_attributes): (&[f32], &[&encode::Attribute]),
    deformed: (&Deformation, &[u32]),
    grid: PageGrid,
) -> Result<EncodedPage> {
    let encoded = encode::encode_deformed(slice, pos, page_attributes, deformed, grid)?;
    let record = geometry_record(&encoded, slice.len());
    Ok((record, encoded.bytes))
}
/// The `geometry` object of a page record: the packed page's facts. Where it lies is its page's
/// bundle (`stream`, `streamOffset`), whose digest proves it.
pub(crate) fn geometry_record(page: &encode::Encoded, indices: usize) -> Value {
    let header = &page.header;
    json!({"bytes":page.bytes.len(),"vertexCount":header.vertex_count,"indexCount":indices,"flags":header.flags,"uncompressedBytes":header.decoded_bytes()})
}
/// The manifest record of the page at culling `rank`: its bounds and its packed `geometry`, the
/// one thing a runtime reads of it; its bundle joins it once packed.
/// `primitive::cost` charges each page by this shape.
pub(crate) fn page_record(
    (rank, cluster): (usize, &DagCluster),
    (min, max): ([f64; 3], [f64; 3]),
    geometry: Value,
) -> Value {
    let parent = |value: fn(&DagCluster) -> Value| match cluster.parent_error.is_finite() {
        true => value(cluster),
        false => Value::Null,
    };
    json!({"id":rank,"count":cluster.indices.len(),"start":cluster.source_rank as usize*3,"min":min,"max":max,
        "role":if cluster.level==0{"exact"}else{"coarse"},
        "geometry":geometry,"level":cluster.level,"lodError":cluster.lod_error,"sphere":cluster.sphere,
        "parentError":parent(|c|json!(c.parent_error)),
        "parentSphere":parent(|c|json!(c.parent_sphere)),
        "group":cluster.group.map_or(Value::Null,|index|json!(index)),
        "source":cluster.source.map_or(Value::Null,|index|json!(index))})
}
