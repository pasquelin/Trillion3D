//! `qem-attributes`: what a coarse level of solved vertices costs in error.
use super::simplification_attributes::compiled;
use super::*;
use crate::dag::{build_dag_tallied, DagStrategy, DagVertices};
use crate::geometry_page::{Attribute, FLAG_NORMAL, FLAG_UV};

// Behaviour: a coarse level made of solved vertices is never the source bit for bit, so it
// carries a positive error — one the runtime still reads as positive once packed in single
// precision — and a threshold of zero draws level zero alone, even where the collapses
// themselves were lossless.
#[test]
fn a_solved_level_carries_a_positive_error() {
    let (root, result, _, _) = compiled("qem-attributes", Sheet::Seam("TEXCOORD_0"));
    let pages = result["primitives"][0]["pages"].as_array().expect("pages");
    let coarse = pages.iter().filter(|page| page["level"] != json!(0));
    assert!(coarse.clone().count() > 0);
    for page in coarse {
        let error = page["lodError"].as_f64().expect("lodError");
        assert!(error as f32 > 0.0, "a coarse page with error {error}");
    }
    fs::remove_dir_all(root).expect("cleanup");
}

// Behaviour: the error of a coarse level is the simplifier's, not the distance its solve slid a
// survivor across the surface. On this plane the collapses cost nothing and the error is what the
// texture asks of the solve alone — measured 1.16 of the sheet's 64 units, while the solve slid a
// survivor 2.00 within the plane, a slide the level used to carry as if the surface had left it.
#[test]
fn the_slide_of_a_solve_is_not_an_error() {
    let (mut positions, normals, _, indices) = seam_sheet(64, 64, true);
    let values = positions
        .as_chunks::<3>()
        .0
        .iter()
        .flat_map(|[x, y, _]| [portable_sin(x * 0.37), portable_sin(y * 0.41)])
        .collect();
    let mut attributes = vec![
        Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: normals,
        },
        Attribute {
            flag: FLAG_UV,
            width: 2,
            values,
        },
    ];
    let built = build_dag_tallied(
        DagVertices {
            positions: &mut positions,
            attributes: &mut attributes,
        },
        &indices,
        DagStrategy::QemAttributes,
        &|| Ok(()),
    )
    .expect("dag");
    assert!(built.added_vertices > 0, "the solve created vertices");
    let worst = built
        .clusters
        .iter()
        .map(|cluster| cluster.lod_error)
        .fold(0.0_f64, f64::max);
    assert!(worst > 0.0 && worst < 1.5, "a plane coarsens at {worst}");
}
