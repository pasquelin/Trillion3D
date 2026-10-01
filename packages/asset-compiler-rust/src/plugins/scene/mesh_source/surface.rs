//! Shared cumulative admission and vertex-opacity material derivation.
use super::*;
pub(in crate::plugins::scene) fn bounded(
    scene: &mut SceneTables,
    name: &str,
    parts: &[(Vertices, Option<usize>)],
    request: &SceneRequest<'_>,
) -> Result<usize> {
    let incoming = parts
        .iter()
        .try_fold(0usize, |sum, (v, _)| {
            sum.checked_add(v.count().saturating_mul(128))
        })
        .unwrap_or(usize::MAX);
    let retained = scene
        .bin
        .bytes
        .len()
        .saturating_mul(2)
        .saturating_add(scene.nodes.len().saturating_mul(512))
        .saturating_add(scene.materials.len().saturating_mul(1024));
    admit(
        retained.saturating_add(incoming),
        request.ram_budget / 2,
        name,
    )?;
    mesh(scene, name, parts)
}
pub(super) fn alpha(
    scene: &mut SceneTables,
    vertices: &Vertices,
    material: Option<usize>,
    derived: &mut std::collections::BTreeMap<Option<usize>, usize>,
) -> Option<usize> {
    if !vertices
        .colors
        .as_chunks::<4>()
        .0
        .iter()
        .any(|rgba| rgba[3] < 1.)
        || material.is_some_and(|m| scene.materials[m]["alphaMode"] == "BLEND")
    {
        return material;
    }
    Some(*derived.entry(material).or_insert_with(|| {
        let mut value = material
            .map(|rank| scene.materials[rank].clone())
            .unwrap_or_else(|| super::material("vertex-colours", [1.; 4]));
        value["alphaMode"] = json!("BLEND");
        value["extras"]["sourceMaterial"] = json!(material);
        let rank = scene.materials.len();
        scene.materials.push(value);
        rank
    }))
}
