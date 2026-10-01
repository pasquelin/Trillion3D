//! Accessor bounds and separate position/normal/UV indices of COLLADA primitives.
use super::*;
pub(super) struct Input {
    pub offset: usize,
    pub semantic: String,
    pub values: Vec<f64>,
    pub stride: usize,
    pub start: usize,
    pub count: usize,
    pub width: usize,
}
impl Input {
    pub(super) fn value(&self, index: usize) -> Result<Vec<f32>> {
        if index >= self.count {
            return Err(source::invalid("collada", "accessor index outside count"));
        }
        let at = self.start + index * self.stride;
        self.values[at..at + self.width]
            .iter()
            .map(|v| source::finite(*v, "collada"))
            .collect()
    }
}
fn source_input(world: &World<'_, '_, '_>, input: Node<'_, '_>, offset: usize) -> Result<Input> {
    let semantic = input.attribute("semantic").unwrap_or("");
    let width = match semantic {
        "POSITION" | "NORMAL" => 3,
        "TEXCOORD" => 2,
        "COLOR" => 4,
        _ => {
            return Err(source::unsupported(
                "collada",
                format!("input semantic {semantic}"),
            ))
        }
    };
    if input.attribute("set").is_some_and(|v| v != "0") {
        return Err(source::unsupported("collada", "multiple UV/colour sets"));
    }
    let source_node = world.lookup(input.attribute("source").unwrap_or(""))?;
    let accessor = xml::required(
        xml::required(source_node, "technique_common", "collada")?,
        "accessor",
        "collada",
    )?;
    let array = world.lookup(accessor.attribute("source").unwrap_or(""))?;
    if !array.has_tag_name("float_array") {
        return Err(source::unsupported(
            "collada",
            "non-float geometry accessor",
        ));
    }
    let declared = xml::usize_attribute(array, "count", "collada")?;
    source::admit(
        declared.saturating_mul(16),
        world.request.ram_budget / 2,
        "collada",
    )?;
    let values = xml::numbers(array, "collada")?;
    if declared != values.len() {
        return Err(source::invalid("collada", "float_array count mismatch"));
    }
    let count = xml::usize_attribute(accessor, "count", "collada")?;
    let parse = |name, default| {
        accessor
            .attribute(name)
            .map(|v| {
                v.parse::<usize>()
                    .map_err(|_| source::invalid("collada", "invalid accessor layout"))
            })
            .unwrap_or(Ok(default))
    };
    let stride = parse("stride", 1)?;
    let start = parse("offset", 0)?;
    let params: Vec<_> = accessor
        .children()
        .filter(|n| n.has_tag_name("param"))
        .collect();
    let width = if semantic == "COLOR" && params.len() == 3 {
        3
    } else {
        width
    };
    if params
        .iter()
        .any(|p| p.attribute("name").is_none() || p.attribute("type") != Some("float"))
    {
        return Err(source::unsupported(
            "collada",
            "unnamed or non-float accessor parameter",
        ));
    }
    let names: Vec<_> = params
        .iter()
        .map(|p| p.attribute("name").unwrap_or(""))
        .collect();
    let supported = match semantic {
        "POSITION" | "NORMAL" => names == ["X", "Y", "Z"],
        "TEXCOORD" => names == ["S", "T"] || names == ["U", "V"],
        "COLOR" => names == ["R", "G", "B"] || names == ["R", "G", "B", "A"],
        _ => false,
    };
    if !supported {
        return Err(source::unsupported("collada", "accessor component order"));
    }
    if params.len() != width
        || stride < width
        || start
            .checked_add(count.saturating_sub(1).saturating_mul(stride))
            .and_then(|n| n.checked_add(if count == 0 { 0 } else { width }))
            .is_none_or(|end| end > values.len())
    {
        return Err(source::invalid(
            "collada",
            "accessor exceeds array or has unsupported width",
        ));
    }
    Ok(Input {
        offset,
        semantic: semantic.into(),
        values,
        stride,
        start,
        count,
        width,
    })
}
pub(super) fn read(
    world: &World<'_, '_, '_>,
    primitive: Node<'_, '_>,
) -> Result<(Vec<Input>, usize)> {
    let mut inputs = Vec::new();
    let mut width = 0;
    for input in primitive.children().filter(|n| n.has_tag_name("input")) {
        let offset = input
            .attribute("offset")
            .unwrap_or("0")
            .parse::<usize>()
            .map_err(|_| source::invalid("collada", "invalid input offset"))?;
        width = width.max(
            offset
                .checked_add(1)
                .ok_or_else(|| source::invalid("collada", "input offset overflow"))?,
        );
        if input.attribute("semantic") == Some("VERTEX") {
            let vertices = world.lookup(input.attribute("source").unwrap_or(""))?;
            if !vertices.has_tag_name("vertices") {
                return Err(source::invalid("collada", "VERTEX must cite vertices"));
            }
            for nested in vertices.children().filter(|n| n.has_tag_name("input")) {
                inputs.push(source_input(world, nested, offset)?);
            }
        } else {
            inputs.push(source_input(world, input, offset)?);
        }
    }
    let mut seen = BTreeSet::new();
    for input in &inputs {
        if !seen.insert(input.semantic.as_str()) {
            return Err(source::invalid("collada", "duplicate input semantic"));
        }
    }
    if !seen.contains("POSITION") {
        return Err(source::invalid("collada", "primitive has no positions"));
    }
    Ok((inputs, width))
}
