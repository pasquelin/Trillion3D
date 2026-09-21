//! The vertex attributes a page carries, read from the primitive.
use super::*;

/// glTF name, page width and flag of every attribute a page carries, in page order. A page
/// carries no tangent: the shader rebuilds it (`compiler_materials.rs`).
pub(super) const PAGE_ATTRIBUTES: [(&str, usize, u32); 4] = [
    ("NORMAL", 3, geometry_page::FLAG_NORMAL),
    ("TEXCOORD_0", 2, geometry_page::FLAG_UV),
    ("TEXCOORD_1", 2, geometry_page::FLAG_UV1),
    ("COLOR_0", 4, geometry_page::FLAG_COLOR),
];

/// glTF name of a page attribute, by its flag.
pub(super) fn attribute_name(flag: u32) -> &'static str {
    PAGE_ATTRIBUTES
        .iter()
        .find(|(_, _, f)| *f == flag)
        .map_or("", |(name, _, _)| name)
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
    for (name, width, flag) in PAGE_ATTRIBUTES {
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
            flag,
            width: a.width,
            values: a.collect_f32()?,
        });
    }
    Ok(attributes)
}
