//! Every cooked page of a primitive decoded back and held against the source it names (#414).
//!
//! A page passes when it decodes, when each decoded corner is the source position its index object
//! names, within the page's quantization error — the exact pages as the coarse ones, so an encode or
//! decode that moves a vertex fails on every level —, when every corner lies in the page's
//! published bounds and sphere, and, for a coarse page, when every vertex it uses belongs to the
//! children of the group that produced it and every point of its triangles lies near that
//! children's surface: within their longest edge plus the group error.
use super::silhouette::page_indices;
use super::*;
use std::collections::HashSet;
use trillion3d_page_codec as codec;

type Point = [f64; 3];

/// Euclidean distance, on the crate's own vector helpers.
fn distance(a: Point, b: Point) -> f64 {
    crate::shared_math::length(crate::shared_math::sub(a, b))
}

/// One decoded page: its source indices and, per corner, the decoded position.
struct Decoded {
    source: Vec<u32>,
    corners: Vec<Point>,
    error: f64,
}

fn decode_page(objects: &Path, page: &Value) -> std::result::Result<Decoded, String> {
    let sha = page["geometry"]["sha256"].as_str().unwrap_or("");
    let bytes =
        fs::read(objects.join(format!("{sha}.bin"))).map_err(|e| format!("page object: {e}"))?;
    let decoded = codec::decode(&bytes, usize::MAX).map_err(|e| format!("decode: {e:?}"))?;
    let source = page_indices(objects, page);
    if decoded.index_count != source.len() {
        return Err(format!(
            "{} decoded indices for {} source",
            decoded.index_count,
            source.len()
        ));
    }
    let position = decoded.attribute(0).expect("position");
    let corners = decoded
        .indices()
        .iter()
        .map(|&i| std::array::from_fn(|c| f64::from(position[i as usize * 3 + c])))
        .collect();
    Ok(Decoded {
        source,
        corners,
        error: f64::from(decoded.quantization_error),
    })
}

/// Source vertex `s` of `positions`, flat `xyz`, or `None` past their end.
fn source_point(positions: &[f32], s: u32) -> Option<Point> {
    let at = s as usize * 3;
    let p = positions.get(at..at + 3)?;
    Some(std::array::from_fn(|a| f64::from(p[a])))
}

/// The defects of one cooked primitive against its source `positions`, flat `xyz`, one line each;
/// empty when every page is sound.
pub(in crate::tests) fn cooked_page_defects(
    objects: &Path,
    primitive: &Value,
    positions: &[f32],
) -> Vec<String> {
    let pages = primitive["pages"].as_array().expect("pages");
    let mut defects = Vec::new();
    let decoded: Vec<Option<Decoded>> = pages
        .iter()
        .enumerate()
        .map(|(id, page)| {
            decode_page(objects, page)
                .map_err(|e| defects.push(format!("page {id}: {e}")))
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
        for (&s, &p) in d.source.iter().zip(&d.corners) {
            let Some(expected) = source_point(positions, s) else {
                defects.push(format!("page {id}: vertex {s} is past the source"));
                continue;
            };
            if distance(p, expected) > d.error + slack(p) {
                defects.push(format!(
                    "page {id}: vertex {s} decodes {p:?}, source {expected:?}"
                ));
            }
            if (0..3).any(|a| p[a] < min[a] - slack(p) || p[a] > max[a] + slack(p)) {
                defects.push(format!("page {id}: vertex {s} at {p:?} outside its bounds"));
            }
            if distance(p, [sphere[0], sphere[1], sphere[2]]) > sphere[3] + slack(p) {
                defects.push(format!("page {id}: vertex {s} at {p:?} outside its sphere"));
            }
        }
    }
    defects.extend(coarse_defects(primitive, pages, &decoded, positions));
    defects
}

/// A coarse page against the children of the group that produced it: its vertices are theirs, and
/// its triangles stay within their longest edge plus the group error of their vertices.
fn coarse_defects(
    primitive: &Value,
    pages: &[Value],
    decoded: &[Option<Decoded>],
    positions: &[f32],
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
        let children: Vec<&Decoded> = ids("children")
            .iter()
            .filter_map(|&c| decoded[c].as_ref())
            .collect();
        let vertices: HashSet<u32> = children
            .iter()
            .flat_map(|d| d.source.iter().copied())
            .collect();
        let points: Vec<Point> = vertices
            .iter()
            .filter_map(|&s| source_point(positions, s))
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
            if let Some(s) = d.source.iter().find(|s| !vertices.contains(s)) {
                defects.push(format!(
                    "page {output}: vertex {s} is not one of group {index}'s"
                ));
            }
            for t in d.corners.chunks(3) {
                let samples =
                    [0, 1, 2].map(|k| std::array::from_fn(|a| (t[k][a] + t[(k + 1) % 3][a]) / 2.0));
                let centroid = std::array::from_fn(|a| (t[0][a] + t[1][a] + t[2][a]) / 3.0);
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
