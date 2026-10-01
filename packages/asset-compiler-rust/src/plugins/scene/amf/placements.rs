//! Constellations share mesh payloads; recursive references are bounded and cycle checked.
use super::*;
use crate::compiler_world::{axis_angle, product, translation, IDENTITY};
use std::collections::BTreeSet;

pub(super) fn place(
    root: Node<'_, '_>,
    scale: f64,
    objects: &BTreeMap<usize, usize>,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
) -> Result<()> {
    let mut sets = BTreeMap::new();
    let mut referenced = BTreeSet::new();
    for constellation in elements(root, "constellation") {
        let id = xml::usize_attribute(constellation, "id", "amf")?;
        if objects.contains_key(&id) || sets.insert(id, constellation).is_some() {
            return Err(source::invalid("amf", "duplicate object/constellation id"));
        }
        for instance in elements(constellation, "instance") {
            referenced.insert(xml::usize_attribute(instance, "objectid", "amf")?);
        }
    }
    for id in &referenced {
        if !objects.contains_key(id) && !sets.contains_key(id) {
            return Err(source::invalid("amf", "unknown constellation target"));
        }
    }
    let mut path = Vec::new();
    let mut checked = BTreeSet::new();
    // Validate even a disconnected cycle before selecting the actual scene roots.
    for &id in sets.keys() {
        validate(id, &sets, &mut path, &mut checked)?;
    }
    for id in objects
        .keys()
        .chain(sets.keys())
        .filter(|id| !referenced.contains(id))
    {
        emit(*id, objects, &sets, scale, request, scene, 0)?;
    }
    Ok(())
}
fn validate(
    id: usize,
    sets: &BTreeMap<usize, Node<'_, '_>>,
    path: &mut Vec<usize>,
    checked: &mut BTreeSet<usize>,
) -> Result<()> {
    if checked.contains(&id) {
        return Ok(());
    }
    if path.len() >= 64 || path.contains(&id) {
        return Err(source::invalid("amf", "constellation cycle/depth"));
    }
    if let Some(set) = sets.get(&id) {
        path.push(id);
        for instance in elements(*set, "instance") {
            validate(
                xml::usize_attribute(instance, "objectid", "amf")?,
                sets,
                path,
                checked,
            )?;
        }
        path.pop();
    }
    checked.insert(id);
    Ok(())
}
fn emit(
    id: usize,
    objects: &BTreeMap<usize, usize>,
    sets: &BTreeMap<usize, Node<'_, '_>>,
    scale: f64,
    request: &SceneRequest<'_>,
    scene: &mut SceneTables,
    depth: usize,
) -> Result<usize> {
    super::super::archive::check(request)?;
    if depth >= 64 {
        return Err(source::invalid("amf", "constellation depth"));
    }
    source::admit(
        (scene.nodes.len() + 1).saturating_mul(512),
        request.ram_budget / 4,
        "amf",
    )?;
    if let Some(mesh) = objects.get(&id) {
        return Ok(scene.node(json!({"name":format!("object-{id}"),"mesh":mesh})));
    }
    let mut children = Vec::new();
    for instance in elements(sets[&id], "instance") {
        let target = xml::usize_attribute(instance, "objectid", "amf")?;
        let child = emit(target, objects, sets, scale, request, scene, depth + 1)?;
        let mut matrix = IDENTITY;
        for (name, axis) in [
            ("rx", [1., 0., 0.]),
            ("ry", [0., 1., 0.]),
            ("rz", [0., 0., 1.]),
        ] {
            matrix = product(
                &axis_angle(axis, component(instance, name, Some(0.))?.to_radians()),
                &matrix,
            );
        }
        let offset = [
            component(instance, "deltax", Some(0.))? * scale,
            component(instance, "deltay", Some(0.))? * scale,
            component(instance, "deltaz", Some(0.))? * scale,
        ];
        for coordinate in offset {
            source::finite(coordinate, "amf")?;
        }
        matrix = product(&translation(offset), &matrix);
        scene.nodes[child]["matrix"] = json!(matrix);
        children.push(child);
    }
    if children.is_empty() {
        return Err(source::invalid("amf", "empty constellation"));
    }
    Ok(scene.node(json!({"name":format!("constellation-{id}"),"children":children})))
}
