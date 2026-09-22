//! Materials: how many a mesh declares and how each is drawn, which the DAG must not care about.
use super::shapes::Sheet;
use super::*;

fn sheet_case(seed: u64, name: &'static str, materials: Vec<Material>) -> Case {
    let mut rng = Rng::new(seed);
    let amplitude = shapes::amplitude(&mut rng);
    let sheet = Sheet::new(&mut rng, shapes::NX, shapes::NY, amplitude);
    let slots = materials.len() as u32;
    let triangles = sheet.indices.len() / 3;
    let mut case = Case::new(name, sheet.positions, sheet.indices);
    // Bands of triangles, one per material, in draw order.
    case.slot_of = (0..triangles)
        .map(|t| (t as u32 * slots) / triangles as u32)
        .collect();
    case.materials = materials;
    case
}

/// Three materials on one mesh: three primitives, each its own DAG.
fn several_materials(seed: u64) -> Case {
    sheet_case(seed, "materials-several", vec![Material::OPAQUE; 3])
}

fn alpha_masked(seed: u64) -> Case {
    sheet_case(
        seed,
        "materials-alpha-masked",
        vec![Material {
            alpha_mode: "MASK",
            double_sided: false,
        }],
    )
}

fn blended(seed: u64) -> Case {
    sheet_case(
        seed,
        "materials-blended",
        vec![Material {
            alpha_mode: "BLEND",
            double_sided: false,
        }],
    )
}

fn double_sided(seed: u64) -> Case {
    sheet_case(
        seed,
        "materials-double-sided",
        vec![Material {
            alpha_mode: "OPAQUE",
            double_sided: true,
        }],
    )
}

pub(super) fn cases() -> Vec<(Generator, Expect)> {
    vec![
        (several_materials, Expect::ONE_ROOT),
        (alpha_masked, Expect::ONE_ROOT),
        (blended, Expect::ONE_ROOT),
        (double_sided, Expect::ONE_ROOT),
    ]
}
