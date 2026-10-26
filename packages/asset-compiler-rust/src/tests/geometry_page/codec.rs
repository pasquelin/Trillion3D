//! Shared decoder golden test: what `encode::encode` writes, `trillion3d_page_codec`
//! re-reads — same triangles, every attribute within what its grid holds, and two source
//! vertices that quantize alike kept once.

use trillion3d_math::sequence::random::xorshift32;
use trillion3d_page_codec::bits::grid::PageGrid;
use trillion3d_page_codec::bits::pow2;
use trillion3d_page_codec::encode::{encode, Attribute};
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV, UV_FLAGS};

/// A float in `[-scale, scale]`, with exact zeros and negative zeros sprinkled in.
fn value(state: &mut u32, scale: f32) -> f32 {
    match xorshift32(state) % 16 {
        0 => 0.0,
        1 => -0.0,
        _ => (xorshift32(state) as f32 / u32::MAX as f32 * 2.0 - 1.0) * scale,
    }
}

fn attributes(count: usize, state: &mut u32) -> Vec<Attribute> {
    // Every texture set a page carries, the sets past the second at the first's scale.
    let sets = UV_FLAGS.map(|flag| (flag, 2, if flag == FLAG_UV { 4.0 } else { 1.0 }));
    [(FLAG_NORMAL, 3, 1.0)]
        .into_iter()
        .chain(sets)
        .chain([(FLAG_COLOR, 3, 1.0)])
        .map(|(flag, width, scale)| Attribute {
            flag,
            width,
            values: (0..count * width).map(|_| value(state, scale)).collect(),
        })
        .collect()
}

/// Mesh with every vertex touched, repeated triangles and shared vertices.
fn mesh(vertices: usize, state: &mut u32) -> (Vec<u32>, Vec<f32>) {
    let positions = (0..vertices * 3).map(|_| value(state, 100.0)).collect();
    let mut indices = Vec::with_capacity(vertices * 3);
    for i in 0..vertices {
        indices.push(i as u32);
        indices.push(((i + 1) % vertices) as u32);
        indices.push((xorshift32(state) as usize % vertices) as u32);
    }
    (indices, positions)
}

fn distance(a: &[f32], b: &[f32]) -> f64 {
    a.iter()
        .zip(b)
        .map(|(x, y)| (f64::from(*x) - f64::from(*y)).powi(2))
        .sum::<f64>()
        .sqrt()
}

/// How far a decoded position may lie from its source, in metres, on `grid`: half a cell's
/// diagonal, and a float's own step at the largest coordinate the tests draw.
pub(crate) fn position_bound(grid: PageGrid) -> f64 {
    let cell = f64::from(pow2(-grid.position)) * 0.01;
    cell * 0.5 * 3f64.sqrt() + 1e-4
}

/// Every decoded vertex against the source vertex its triangle names, within what its grid holds:
/// `bound` metres for a position, the colour byte's half step, the texture code's.
pub(crate) fn verify(
    page: &trillion3d_page_codec::DecodedPage,
    indices: &[u32],
    positions: &[f32],
    attrs: &[Attribute],
    bound: f64,
) {
    // The page lays each triangle from the corner its strip starts at, the triangles in the
    // order of the source: a triangle's corners are the source's, turned by the rotation that
    // puts each at its own position.
    let decoded = page.attribute(0).expect("position");
    let turn = |triangle: usize| {
        let cost = |rotation: usize| -> f64 {
            (0..3)
                .map(|k| {
                    let local = page.indices()[triangle * 3 + k] as usize;
                    let source = indices[triangle * 3 + (k + rotation) % 3] as usize;
                    distance(
                        &decoded[local * 3..local * 3 + 3],
                        &positions[source * 3..source * 3 + 3],
                    )
                })
                .sum()
        };
        (0..3)
            .min_by(|&a, &b| cost(a).total_cmp(&cost(b)))
            .unwrap_or(0)
    };
    assert_eq!(
        page.indices().len(),
        indices.len(),
        "every triangle is laid"
    );
    for corner in 0..indices.len() {
        let triangle = corner / 3;
        let local = page.indices()[corner] as usize;
        let source = indices[triangle * 3 + (corner % 3 + turn(triangle)) % 3] as usize;
        let position = &page.attribute(0).expect("position")[local * 3..local * 3 + 3];
        let wanted = &positions[source * 3..source * 3 + 3];
        // The page decodes its cell to a single-precision coordinate, twice rounded — the cell
        // index to a float, then times the cell — so far from the origin a float's own step adds.
        let largest = wanted.iter().fold(0f32, |m, &v| m.max(v.abs()));
        let limit = bound + 2.0 * f64::from(largest) * f64::from(f32::EPSILON);
        assert!(distance(position, wanted) <= limit);
        for attribute in attrs {
            // Ranks follow the page's fixed attribute order, present or not.
            let rank = 1 + trillion3d_page_codec::OPTIONAL
                .iter()
                .position(|(bit, _)| *bit == attribute.flag)
                .expect("a page attribute");
            let decoded = page.attribute(rank).expect("decoded attribute");
            let width = attribute.width;
            let expected = &attribute.values[source * width..source * width + width];
            match attribute.flag {
                FLAG_NORMAL => {
                    // A zero normal has no direction: the format gives it `+z`.
                    let length = distance(expected, &[0.0; 3]);
                    let unit: Vec<f32> = if length == 0.0 {
                        vec![0.0, 0.0, 1.0]
                    } else {
                        expected
                            .iter()
                            .map(|v| (f64::from(*v) / length) as f32)
                            .collect()
                    };
                    let dot: f64 = decoded[local * 3..local * 3 + 3]
                        .iter()
                        .zip(&unit)
                        .map(|(a, b)| f64::from(*a) * f64::from(*b))
                        .sum();
                    assert!(
                        dot.clamp(-1.0, 1.0).acos().to_degrees() < 1.0,
                        "normal {corner}: {dot}"
                    );
                }
                FLAG_COLOR => {
                    for c in 0..3 {
                        let got = f64::from(decoded[local * 4 + c]);
                        assert!(
                            (got - f64::from(expected[c].clamp(0.0, 1.0))).abs()
                                <= 0.5 / 255.0 + 1e-6
                        );
                    }
                    assert_eq!(decoded[local * 4 + 3], 1.0);
                }
                // A texture code of 14 mantissa bits: a value under 1 is within half of 2^-14, a
                // value from 1 up within the same relative step (2^-15 of it): a component's
                // error is at most 2^-15 times the greater of 1 and its magnitude, whatever
                // coordinate the build's solve placed (a solved wedge may lie past the source's).
                _ => {
                    let half_step = f64::from(pow2(-15));
                    let bound = expected
                        .iter()
                        .map(|v| (half_step * f64::from(v.abs()).max(1.0)).powi(2))
                        .sum::<f64>()
                        .sqrt()
                        * (1.0 + 1e-6);
                    let got = &decoded[local * 2..local * 2 + 2];
                    assert!(
                        distance(got, expected) <= bound,
                        "texture coordinate {got:?} for {expected:?}"
                    );
                }
            }
        }
    }
}

fn round_trip(vertices: usize, seed: u32) {
    let mut state = seed;
    let (indices, positions) = mesh(vertices, &mut state);
    let attrs = attributes(vertices, &mut state);
    let carried: Vec<&Attribute> = attrs.iter().collect();
    let grid = PageGrid::at(1);
    let encoded = encode(&indices, &positions, &carried, grid).expect("encode");
    let page = trillion3d_page_codec::decode(&encoded.bytes, 64 << 20).expect("decode");
    let header = &encoded.header;
    assert_eq!(page.flags, header.flags);
    assert_eq!(page.vertex_count, header.vertex_count);
    assert_eq!(page.decoded_bytes(), header.decoded_bytes());
    assert_eq!(
        page.decoded_bytes(),
        header.vertex_count * (3 + 3 + 2 * UV_FLAGS.len() + 4) * 4 + indices.len() * 4
    );
    // The page on disk lays out as the resident page the install pass writes: whole words.
    assert_eq!(header.resident_bytes() % 4, 0);
    verify(&page, &indices, &positions, &attrs, position_bound(grid));
}

#[test]
fn golden_page_reread_within_what_its_grid_holds() {
    // Each triangle lays two vertices at most, the third being the one the triangle before it
    // laid last: 120 triangles lay no more than a page holds.
    for (vertices, seed) in [(3usize, 1u32), (17, 7), (64, 99), (120, 424_242)] {
        round_trip(vertices, seed);
    }
}

/// A cluster of a regular grid: its corners, numbered by first use, cost well under the
/// fixed width of a local index, and decode to the same triangles.
#[test]
fn a_grid_cluster_codes_its_corners_below_their_fixed_width() {
    let side = 9u32;
    let positions: Vec<f32> = (0..side * side)
        .flat_map(|v| [(v % side) as f32, (v / side) as f32, 0.0])
        .collect();
    let indices: Vec<u32> = (0..side - 1)
        .flat_map(|r| (0..side - 1).map(move |c| r * side + c))
        .flat_map(|v| [v, v + 1, v + side, v + 1, v + side + 1, v + side])
        .collect();
    let grid = PageGrid::at(0);
    let encoded = encode(&indices, &positions, &[], grid).expect("encode");
    let fixed_bits = indices.len() * 7;
    let corner_bits = trillion3d_page_codec::Layout::of(&encoded.header).position[0] * 32;
    assert!(
        corner_bits * 10 < fixed_bits * 8,
        "{corner_bits} of {fixed_bits} bits"
    );
    let page = trillion3d_page_codec::decode(&encoded.bytes, 1 << 20).expect("decode");
    verify(&page, &indices, &positions, &[], position_bound(grid));
}
