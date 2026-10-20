//! The defects of a cooked primitive's decoded pages against their source: every corner inside its
//! page's bounds, each corner of an exact page inside its sphere — its vertices' smallest ball —
//! and within its page's quantization error of its vertex, and a coarse page's triangles held to
//! the children of the group that produced it. A coarse page's sphere is its children's balls',
//! which projects the error and bounds nothing it draws (`dag/reduce.rs`).
//!
//! A coarse page is held to its bounds and its children's surface alone. Its vertices
//! sit where each merge's quadric put them, optimized off both ends of the edge it collapsed, and
//! the page quantizes that position: a coarse corner is neither a source vertex within the
//! quantization error nor one of its children's vertices, and the nearest source vertex it is
//! matched to says nothing of where it should decode.
use super::cooked_pages::{distance, PageCorners, Point};
use super::*;
use trillion3d_math::vec3::point_checked;

/// The defects of one cooked primitive against its source `positions`, flat `xyz`, one line each;
/// empty when every page is sound.
pub(in crate::tests) fn cooked_page_defects(
    read: Vec<std::result::Result<PageCorners, String>>,
    primitive: &Value,
    positions: &[f32],
) -> Vec<String> {
    let pages = primitive["pages"].as_array().expect("pages");
    let mut defects = Vec::new();
    let decoded: Vec<Option<PageCorners>> = read
        .into_iter()
        .enumerate()
        .map(|(id, page)| {
            page.map_err(|e| defects.push(format!("page {id}: {e}")))
                .ok()
        })
        .collect();
    for (id, (page, d)) in pages.iter().zip(&decoded).enumerate() {
        let Some(d) = d else { continue };
        let min: Vec<f64> = (0..3)
            .map(|a| page["min"][a].as_f64().expect("min"))
            .collect();
        let max: Vec<f64> = (0..3)
            .map(|a| page["max"][a].as_f64().expect("max"))
            .collect();
        let sphere: Vec<f64> = (0..4)
            .map(|a| page["sphere"][a].as_f64().expect("sphere"))
            .collect();
        let slack = |p: Point| 2.0 * d.error + 1e-5 * p.iter().map(|v| v.abs()).fold(1.0, f64::max);
        let exact = page["level"].as_u64() == Some(0);
        for (&s, &p) in d.source.iter().zip(&d.corners) {
            let Some(expected) = point_checked(positions, s) else {
                defects.push(format!("page {id}: vertex {s} is past the source"));
                continue;
            };
            if exact && distance(p, expected) > d.error + slack(p) {
                defects.push(format!(
                    "page {id}: vertex {s} decodes {p:?}, source {expected:?}"
                ));
            }
            if (0..3).any(|a| p[a] < min[a] - slack(p) || p[a] > max[a] + slack(p)) {
                defects.push(format!("page {id}: vertex {s} at {p:?} outside its bounds"));
            }
            if exact && distance(p, [sphere[0], sphere[1], sphere[2]]) > sphere[3] + slack(p) {
                defects.push(format!("page {id}: vertex {s} at {p:?} outside its sphere"));
            }
        }
    }
    defects.extend(coarse_defects(primitive, pages, &decoded));
    defects
}

/// A coarse page against the children of the group that produced it: every point of its
/// triangles — each edge's middle and the centroid — lies within the children's longest edge plus
/// the group error of a corner the children decode to.
fn coarse_defects(
    primitive: &Value,
    pages: &[Value],
    decoded: &[Option<PageCorners>],
) -> Vec<String> {
    let groups = primitive["structure"]["groups"].as_array().expect("groups");
    let mut defects = Vec::new();
    for (index, group) in groups.iter().enumerate() {
        let ids = |key: &str| -> Vec<usize> {
            group[key]
                .as_array()
                .expect(key)
                .iter()
                .map(|v| v.as_u64().expect("id") as usize)
                .collect()
        };
        let children: Vec<&PageCorners> = ids("children")
            .iter()
            .filter_map(|&c| decoded[c].as_ref())
            .collect();
        let points: Vec<Point> = (children.iter())
            .flat_map(|d| d.corners.iter().copied())
            .collect();
        let longest = children
            .iter()
            .flat_map(|d| {
                d.corners
                    .chunks(3)
                    .flat_map(|t| (0..3).map(move |k| distance(t[k], t[(k + 1) % 3])))
            })
            .fold(0.0, f64::max);
        let error = group["error"].as_f64().expect("error");
        for output in ids("outputs") {
            let Some(d) = decoded[output].as_ref() else {
                continue;
            };
            assert_eq!(
                pages[output]["source"].as_u64(),
                Some(index as u64),
                "output {output}"
            );
            for t in d.corners.chunks(3) {
                let samples =
                    [0, 1, 2].map(|k| trillion3d_math::aabb::centre(t[k], t[(k + 1) % 3]));
                let centroid = trillion3d_math::triangle::centroid([t[0], t[1], t[2]]);
                for sample in samples.into_iter().chain([centroid]) {
                    let near = points
                        .iter()
                        .map(|&p| distance(p, sample))
                        .fold(f64::INFINITY, f64::min);
                    if near > longest + 2.0 * error + d.error * 4.0 + 1e-4 {
                        defects.push(format!(
                            "page {output}: triangle {t:?} leaves group {index} by {near} (edge {longest}, error {error})"
                        ));
                        break;
                    }
                }
            }
        }
    }
    defects
}
