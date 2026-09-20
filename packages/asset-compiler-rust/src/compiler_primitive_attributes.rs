//! The vertex attributes a page carries, read from the primitive in the page's own layout.
use super::*;

/// glTF name, width, page offset and flag of every attribute a page carries, in page order.
pub(super) const PAGE_ATTRIBUTES: [(&str, usize, usize, u32); 5] = [
    ("NORMAL", 3, 12, geometry_page::FLAG_NORMAL),
    ("TEXCOORD_0", 2, 24, geometry_page::FLAG_UV),
    ("TANGENT", 4, 32, geometry_page::FLAG_TANGENT),
    ("TEXCOORD_1", 2, 48, geometry_page::FLAG_UV1),
    ("COLOR_0", 4, 56, geometry_page::FLAG_COLOR),
];

/// glTF name of a page attribute, by its flag.
pub(super) fn attribute_name(flag: u32) -> &'static str {
    PAGE_ATTRIBUTES
        .iter()
        .find(|(_, _, _, f)| *f == flag)
        .map_or("", |(name, _, _, _)| name)
}

/// Decodes, as float, every page attribute the primitive declares. Each must count as many
/// vertices as POSITION; COLOR_0 may come three wide, the page widens it.
pub(super) fn decode_page_attributes(
    g: &Value,
    bin: &[u8],
    p: &Value,
    vertices: usize,
    validated: &BTreeSet<usize>,
) -> Result<Vec<geometry_page::Attribute>> {
    let mut attributes = Vec::new();
    for (name, width, offset, flag) in PAGE_ATTRIBUTES {
        let Some(id) = p
            .get("attributes")
            .and_then(Value::as_object)
            .and_then(|attributes| attributes.get(name))
        else {
            continue;
        };
        let a = accessor(g, bin, required_index(Some(id), name)?, Some(validated))?;
        if a.count != vertices || (a.width != width && !(name == "COLOR_0" && a.width == 3)) {
            return Err(CompilerError::new(
                "INVALID_PAGE_ATTRIBUTE",
                format!("{name} count or width differs from POSITION"),
            ));
        }
        attributes.push(geometry_page::Attribute {
            offset,
            width,
            source_width: a.width,
            flag,
            values: a.collect_f32()?,
        });
    }
    Ok(attributes)
}
