//! A USD `BasisCurves` into the strands of a groom, read into a `Description` (`hair_strands`).
//!
//! The curves are read from `curveVertexCounts` and `points`, to the end of what the prim declares: a
//! curve that would make the counts pass the points ends the prim's curves, and the rest are left out.
//! Their widths come from `widths` by its interpolation — `uniform`, one for each curve, `vertex`, one
//! for each point, the schema's fallback when none is authored, `constant`, the width of the whole
//! groom, counted only when the prim is the top of the scene —, taken to metres by the unit of the
//! layer and by nothing else. The group number and name of each curve, its root coordinates, and the
//! colour and roughness of each point come from the `groom_group_id`, `groom_group_name`,
//! `groom_root_uv`, `groom_color` and `groom_roughness` primvars: a primvar of `uniform` or `constant`
//! interpolation, or of as many values as curves, is a curve's, one of `vertex` interpolation or of as
//! many values as points a point's; one that names no interpolation is `constant`, the schema's
//! fallback (what the groom makes of them, by interpolation and by count, is `hair_strands`'). The groom's width may also be declared as the `userProperties:groom_width` of the top
//! prim of the scene (`declared_width`), which wins over `widths` of `constant`. The type, basis and
//! wrap of the curves describe how a spline runs through the points: the strands are drawn through
//! their points, so none is read. `NurbsCurves` and `HermiteCurves` are not read (`world::refusal`).
use super::*;
use crate::hair_strands::{finite_width, Description, Scope};
use crate::plugins::scene::codes::CURVES_TRUNCATED;

/// The scope an interpolation names.
fn scope_of(interpolation: &str) -> Scope {
    match interpolation {
        "constant" => Scope::Constant,
        "uniform" => Scope::Uniform,
        "vertex" => Scope::Vertex,
        _ => Scope::Other,
    }
}

/// The values of the primvar `name` of `prim` flattened through its indices, and the scope its
/// interpolation names — `constant` when it names none —; `None` when the prim has no such primvar.
/// A `uniform` one holds a value for each of the `strands` curves, or is not read.
fn read_primvar<T: Clone>(
    prim: &usd::Prim,
    name: &str,
    decode: impl Fn(&sdf::Value) -> Option<Vec<T>>,
    strands: usize,
) -> Option<(Scope, Vec<T>)> {
    let written = primvar::written(prim, &format!("primvars:{name}"), decode)?;
    let scope = scope_of(written.interpolation.as_deref().unwrap_or("constant"));
    let values = written.flattened()?;
    (scope != Scope::Uniform || values.len() == strands).then_some((scope, values))
}

/// The width the groom declares as the `userProperties:groom_width` of `prim`, in metres, if it
/// does: read on the top prim of the scene, whatever its type, `unit` metres to a unit of the layer.
pub(super) fn declared_width(prim: &usd::Prim, unit: f64) -> Option<f32> {
    let (value, _) = read::first(&prim.attribute("userProperties:groom_width"))?;
    finite_width(read::number(&value)?).map(|width| width * unit as f32)
}

/// The `extensions` that cite the strands of a `BasisCurves` prim, written into the scene's binary;
/// `None` when the prim carries no strand. `top` says whether the prim is the top of the scene.
pub(super) fn build(world: &mut World<'_>, prim: &usd::Prim, top: bool) -> Option<Value> {
    let declared = read::integers(&world.first(prim, "curveVertexCounts")?)?;
    let points = read::triples(&world.first(prim, "points")?)?;
    let positions = points.into_iter().flatten().collect();
    let (groom, truncated) = Description::from_declared(positions, declared);
    if truncated {
        world.scene.report.add(CURVES_TRUNCATED);
    }
    let mut groom = groom?;
    let strands = groom.counts.len();
    let scale = world.unit as f32;
    let mut constant = None;
    if let Some(widths) = world
        .first(prim, "widths")
        .and_then(|value| read::floats(&value))
    {
        // The schema's fallback interpolation of the widths is `vertex`.
        let interpolation = read::metadata(&prim.attribute("widths"), "interpolation");
        match scope_of(interpolation.as_deref().unwrap_or("vertex")) {
            // A width of the whole groom counts only on the top prim of the scene.
            Scope::Constant if top => constant = widths.first().map(|width| width * scale),
            Scope::Constant => {}
            scope => groom.set_widths(scope, &widths, scale),
        }
    }
    let numbers = |value: &sdf::Value| -> Option<Vec<i32>> {
        (read::integers(value)?.into_iter())
            .map(|id| i32::try_from(id).ok())
            .collect()
    };
    if let Some((scope, ids)) = read_primvar(prim, "groom_group_id", numbers, strands) {
        groom.set_group_ids(scope, ids);
    }
    if let Some((scope, names)) = read_primvar(prim, "groom_group_name", read::strings, strands) {
        groom.set_group_names(scope, &names);
    }
    if let Some((scope, uvs)) = read_primvar(prim, "groom_root_uv", read::pairs, strands) {
        groom.set_root_uvs(scope, uvs.into_iter().flatten().collect());
    }
    if let Some((scope, colors)) = read_primvar(prim, "groom_color", read::triples, strands) {
        groom.set_colors(scope, colors.into_iter().flatten().collect());
    }
    if let Some((scope, roughness)) = read_primvar(prim, "groom_roughness", read::floats, strands) {
        groom.set_roughness(scope, roughness);
    }
    groom.groom_width = world.root_width.or(constant);
    Some(world.scene.strands(&groom))
}
