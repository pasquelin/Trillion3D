//! Vertex attributes beside the texture: normals, colours and tangents, present or not.
use super::attributes_colours::{every_attribute, tangents_present, vertex_colour_steps};
use super::shapes::{amplitude, face_normal, Exploded, Sheet, NX, NY};
use super::*;

/// Flat shading: every quad owns its vertices and carries its face normal.
pub(super) fn hard_normals(seed: u64) -> Case {
    let mut rng = seeded(seed);
    let amplitude = amplitude(&mut rng);
    let quads = Exploded::new(&mut rng, NX, NY, amplitude);
    let normals = (0..quads.positions.len() / 3)
        .flat_map(|v| face_normal(&quads.positions, v / 4 * 4))
        .collect();
    let mut case = Case::new("attributes-hard-normals", quads.positions, quads.indices);
    case.normals = Some(normals);
    case
}

/// Flat-shaded quads under an atlas of square charts, `side` quads a side and drawn from the seed:
/// a hard normal at every quad edge and a texture seam at every chart edge, both at once.
fn hard_normals_charted(seed: u64) -> Case {
    let mut case = hard_normals(seed);
    case.name = "attributes-hard-normals-charted";
    let side = seeded(seed ^ 0xC4A7).between(2, 9);
    let charts = NX.div_ceil(side);
    case.uv0 = Some(
        (0..case.vertex_count())
            .flat_map(|v| {
                let quad = v / 4;
                let (qx, qy) = (quad % NX, quad / NX);
                let (cx, cy) = Exploded::corner_of(v);
                // Each chart a cell of the atlas, a margin of half a quad around it.
                let local = |q: usize, c: usize| (q % side + c) as f32 + 0.5;
                [
                    ((qx / side * (side + 1)) as f32 + local(qx, cx))
                        / (charts * (side + 1)) as f32,
                    ((qy / side * (side + 1)) as f32 + local(qy, cy))
                        / (charts * (side + 1)) as f32,
                ]
            })
            .collect(),
    );
    case
}

/// Flat-shaded quads with some quads missing, drawn from the seed: open borders inside the
/// sheet, around holes of one quad or a few, beside the hard normals.
fn hard_normals_holed(seed: u64) -> Case {
    let mut case = hard_normals(seed);
    case.name = "attributes-hard-normals-holed";
    let mut rng = seeded(seed ^ 0x401E);
    let share = 0.05 + rng.unit() * 0.2;
    let quads: Vec<[u32; 6]> = case.indices.as_chunks::<6>().0.to_vec();
    case.indices = quads
        .into_iter()
        .filter(|_| rng.unit() >= share)
        .flatten()
        .collect();
    case
}

/// Smooth shading: one normal per shared vertex, from the relief's finite differences.
pub(super) fn smooth_normals(seed: u64) -> Case {
    let mut rng = seeded(seed);
    let amplitude = amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, NX, NY, amplitude);
    let z = |x: usize, y: usize| sheet.positions[sheet.vertex(x, y) as usize * 3 + 2];
    let normals = (0..sheet.positions.len() / 3)
        .flat_map(|v| {
            let (x, y) = (sheet.x_of(v), sheet.y_of(v));
            let dx = (z((x + 1).min(NX), y) - z(x.saturating_sub(1), y)) / 2.0;
            let dy = (z(x, (y + 1).min(NY)) - z(x, y.saturating_sub(1))) / 2.0;
            let length = trillion3d_math::vector::vecn::length([dx, dy, 1.0]);
            [-dx / length, -dy / length, 1.0 / length]
        })
        .collect();
    let mut case = Case::new("attributes-smooth-normals", sheet.positions, sheet.indices);
    case.normals = Some(normals);
    case
}

/// `case` with every normal turned around, against its winding: each face lit from behind as a
/// badly exported mesh ships it.
fn against_winding(mut case: Case, name: &'static str) -> Case {
    case.name = name;
    if let Some(normals) = &mut case.normals {
        normals.iter_mut().for_each(|n| *n = -*n);
    }
    case
}

/// `smooth_normals` lit from behind (`against_winding`).
fn smooth_normals_against_winding(seed: u64) -> Case {
    against_winding(
        smooth_normals(seed),
        "attributes-smooth-normals-against-winding",
    )
}

/// `hard_normals_charted` lit from behind (`against_winding`): every corner a choice of copies.
fn hard_normals_against_winding(seed: u64) -> Case {
    let case = hard_normals_charted(seed);
    against_winding(case, "attributes-hard-normals-against-winding")
}

/// Each case with normals, and the same case lit from behind (`against_winding`).
pub(super) fn turned_around() -> [(Generator, Generator); 2] {
    [
        (smooth_normals, smooth_normals_against_winding),
        (hard_normals_charted, hard_normals_against_winding),
    ]
}

/// A rock turned on a lathe (`solids::lathe`), its profile drawn from the seed: a narrow foot,
/// one to three bulges, and an apex written once per column, each copy with its column's normal,
/// the triangles beside it with two corners on it. Its radii wobble by up to a quarter of
/// themselves, more than a band climbs where the profile lies nearly flat: the surface folds, and
/// some of its faces are lit from behind as written. The apex's triangles have no area once its
/// copies are welded by position: the simplifier removes them first (the degenerate
/// test, `simplify/region/collapse/fixup.rs`).
fn turned_rock(seed: u64) -> Case {
    let mut rng = seeded(seed);
    let mut profile = vec![[0.05 + rng.unit() * 0.25, 0.0]];
    for _ in 0..rng.between(1, 3) {
        let height = profile[profile.len() - 1][1] + 0.1 + rng.unit() * 1.4;
        profile.push([0.5 + rng.unit() * 2.0, height]);
    }
    profile.push([0.0, profile[profile.len() - 1][1] + 0.3 + rng.unit() * 0.7]);
    let (segments, rings) = (rng.between(32, 96), rng.between(8, 24));
    let wobble = rng.unit() * 0.25;
    let (positions, indices, normals) =
        super::solids::lathe(&profile, segments, rings, wobble, &mut rng);
    let mut case = Case::new("attributes-turned-rock", positions, indices);
    case.normals = Some(normals);
    case
}

/// The cases whose last groups have little to spare — every vertex a hard edge, a seam corner or
/// both, or disjoint parts whose vertices outnumber what a cluster holds —, and a lathe's apex,
/// one copy per column, which the corpus runs on many seeds: one seed's luck never hides a second
/// root.
pub(super) fn knife_edges() -> Vec<(Generator, Expect)> {
    vec![
        (hard_normals as Generator, Expect::ONE_ROOT),
        (turned_rock, Expect::ONE_ROOT),
        (hard_normals_charted, Expect::ONE_ROOT),
        (hard_normals_holed, Expect::ONE_ROOT),
        (every_attribute, Expect::ONE_ROOT),
        (super::uv::island_per_brick, Expect::ONE_ROOT),
        (super::uv::island_per_face, Expect::ONE_ROOT),
        (super::topology::slats, Expect::ONE_ROOT),
    ]
}

pub(super) fn cases() -> Vec<(Generator, Expect)> {
    vec![
        (hard_normals, Expect::ONE_ROOT),
        (hard_normals_charted, Expect::ONE_ROOT),
        (hard_normals_holed, Expect::ONE_ROOT),
        (smooth_normals, Expect::ONE_ROOT),
        (smooth_normals_against_winding, Expect::ONE_ROOT),
        (hard_normals_against_winding, Expect::ONE_ROOT),
        (turned_rock, Expect::ONE_ROOT),
        (vertex_colour_steps, Expect::ONE_ROOT),
        (tangents_present, Expect::ONE_ROOT),
        (every_attribute, Expect::ONE_ROOT),
    ]
}
