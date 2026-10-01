//! Polygon streams retain their source order and material-symbol bindings on each instance.
use super::*;
use inputs::Input;
fn indices(node: Node<'_, '_>) -> Result<Vec<usize>> {
    node.text()
        .unwrap_or("")
        .split_whitespace()
        .map(|v| {
            v.parse()
                .map_err(|_| source::invalid("collada", "invalid polygon index"))
        })
        .collect()
}
fn rings(primitive: Node<'_, '_>, width: usize) -> Result<Vec<Vec<usize>>> {
    let count = xml::usize_attribute(primitive, "count", "collada")?;
    let mut rings = Vec::new();
    match primitive.tag_name().name() {
        "triangles" => {
            let values = indices(xml::required(primitive, "p", "collada")?)?;
            if count.checked_mul(3).and_then(|n| n.checked_mul(width)) != Some(values.len()) {
                return Err(source::invalid("collada", "triangle count mismatch"));
            }
            rings.extend(values.chunks_exact(3 * width).map(<[usize]>::to_vec));
        }
        "polylist" => {
            let values = indices(xml::required(primitive, "p", "collada")?)?;
            let counts = indices(xml::required(primitive, "vcount", "collada")?)?;
            if counts.len() != count {
                return Err(source::invalid("collada", "polylist count mismatch"));
            }
            let mut at = 0usize;
            for corners in counts {
                let end = at
                    .checked_add(
                        corners
                            .checked_mul(width)
                            .ok_or_else(|| source::invalid("collada", "polygon size overflow"))?,
                    )
                    .ok_or_else(|| source::invalid("collada", "polygon offset overflow"))?;
                rings.push(
                    values
                        .get(at..end)
                        .ok_or_else(|| source::invalid("collada", "short polygon"))?
                        .to_vec(),
                );
                at = end;
            }
            if at != values.len() {
                return Err(source::invalid("collada", "surplus polygon indices"));
            }
        }
        "polygons" => {
            if primitive.children().any(|n| n.has_tag_name("ph")) {
                return Err(source::unsupported("collada", "polygon holes"));
            }
            for p in primitive.children().filter(|n| n.has_tag_name("p")) {
                rings.push(indices(p)?);
            }
            if rings.len() != count {
                return Err(source::invalid("collada", "polygon count mismatch"));
            }
        }
        other => return Err(source::unsupported("collada", format!("primitive {other}"))),
    }
    Ok(rings)
}
fn append(out: &mut Vertices, inputs: &[Input], indices: &[usize]) -> Result<()> {
    out.indices.push(
        u32::try_from(out.count()).map_err(|_| source::invalid("collada", "too many corners"))?,
    );
    for input in inputs {
        let value = input.value(indices[input.offset])?;
        match input.semantic.as_str() {
            "POSITION" => out.positions.extend(value),
            "NORMAL" => out.normals.extend(value),
            "TEXCOORD" => out.uvs.extend([value[0], 1.0 - value[1]]),
            "COLOR" => {
                out.colors.extend(&value);
                if value.len() == 3 {
                    out.colors.push(1.0);
                }
            }
            _ => unreachable!(),
        }
    }
    Ok(())
}
fn part(world: &World<'_, '_, '_>, primitive: Node<'_, '_>) -> Result<Vertices> {
    let (inputs, width) = inputs::read(world, primitive)?;
    let position = inputs.iter().find(|i| i.semantic == "POSITION").unwrap();
    let mut out = Vertices::default();
    let mut cutter = super::super::ngon::Ngon::default();
    for ring in rings(primitive, width)? {
        if ring.len() % width != 0 || !(3..=4096).contains(&(ring.len() / width)) {
            return Err(source::unsupported(
                "collada",
                "polygon must contain3..4096 complete corners",
            ));
        }
        source::admit(
            out.count()
                .saturating_add(ring.len() / width * 3)
                .saturating_mul(256),
            world.request.ram_budget / 2,
            "collada",
        )?;
        cutter.begin();
        for corner in ring.chunks_exact(width) {
            let point = position.value(corner[position.offset])?;
            cutter.corner([point[0] as f64, point[1] as f64, point[2] as f64]);
        }
        match cutter.cut(world.request.cancelled) {
            None => return Err(super::super::cancel::refusal()),
            Some(false) if ring.len() != 3 * width => {
                return Err(source::invalid("collada", "invalid polygon"))
            }
            _ => {}
        }
        for triangle in cutter.triangles() {
            for corner in triangle {
                append(
                    &mut out,
                    &inputs,
                    &ring[corner * width..(corner + 1) * width],
                )?;
            }
        }
    }
    Ok(out)
}
pub(super) fn instance(world: &mut World<'_, '_, '_>, instance: Node<'_, '_>) -> Result<usize> {
    let uri = instance.attribute("url").unwrap_or("");
    let geometry = world.lookup(uri)?;
    let mut bindings = BTreeMap::new();
    if let Some(common) =
        xml::child(instance, "bind_material").and_then(|n| xml::child(n, "technique_common"))
    {
        for binding in common
            .children()
            .filter(|n| n.has_tag_name("instance_material"))
        {
            let symbol = binding
                .attribute("symbol")
                .ok_or_else(|| source::invalid("collada", "material binding without symbol"))?;
            let target = xml::fragment(binding.attribute("target").unwrap_or(""), "collada")?;
            let rank = *world
                .materials
                .get(target)
                .ok_or_else(|| source::invalid("collada", "material binding target missing"))?;
            if bindings.insert(symbol, rank).is_some() {
                return Err(source::invalid("collada", "duplicate material symbol"));
            }
            for v in binding
                .children()
                .filter(|n| n.has_tag_name("bind_vertex_input"))
            {
                if v.attribute("input_semantic") != Some("TEXCOORD")
                    || v.attribute("input_set").is_some_and(|s| s != "0")
                {
                    return Err(source::unsupported(
                        "collada",
                        "nonzero texture coordinate binding",
                    ));
                }
            }
        }
    }
    let key = format!("{uri}:{bindings:?}");
    if let Some(mesh) = world.meshes.get(&key) {
        return Ok(*mesh);
    }
    let mesh = xml::required(geometry, "mesh", "collada")?;
    let mut parts = Vec::new();
    for primitive in mesh.children().filter(|n| {
        n.is_element() && !["source", "vertices", "extra"].contains(&n.tag_name().name())
    }) {
        let material = primitive
            .attribute("material")
            .map(|symbol| {
                bindings.get(symbol).copied().ok_or_else(|| {
                    source::invalid("collada", format!("unbound material symbol {symbol}"))
                })
            })
            .transpose()?;
        parts.push((part(world, primitive)?, material));
    }
    let rank = source::mesh_bounded(
        world.scene,
        geometry
            .attribute("name")
            .or_else(|| geometry.attribute("id"))
            .unwrap_or("geometry"),
        &parts,
        world.request,
    )?;
    world.meshes.insert(key, rank);
    Ok(rank)
}
