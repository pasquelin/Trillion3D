//! Shared decoder golden test: what `geometry_page::encode` writes, `trillion3d_page_codec`
//! re-reads — same triangles, every attribute within the grid's declared error, and two source
//! vertices that quantize alike kept once.

use crate::geometry_page::{encode, Attribute, FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1};
use crate::geometry_page_quant::UV_EXPONENT;
use trillion3d_page_codec as codec;
use trillion3d_page_codec::bits::pow2;

fn xorshift(state: &mut u32) -> u32 {
    *state ^= *state << 13;
    *state ^= *state >> 17;
    *state ^= *state << 5;
    *state
}

/// A float in `[-scale, scale]`, with exact zeros and negative zeros sprinkled in.
fn value(state: &mut u32, scale: f32) -> f32 {
    match xorshift(state) % 16 {
        0 => 0.0,
        1 => -0.0,
        _ => (xorshift(state) as f32 / u32::MAX as f32 * 2.0 - 1.0) * scale,
    }
}

fn attributes(count: usize, state: &mut u32) -> Vec<Attribute> {
    [
        (FLAG_NORMAL, 3, 1.0),
        (FLAG_UV, 2, 4.0),
        (FLAG_UV1, 2, 1.0),
        (FLAG_COLOR, 3, 1.0),
    ]
    .into_iter()
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
        indices.push((xorshift(state) as usize % vertices) as u32);
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

/// Every decoded vertex against the source vertex its triangle names, within the declared error.
pub(crate) fn verify(
    page: &codec::DecodedPage,
    indices: &[u32],
    positions: &[f32],
    attrs: &[Attribute],
    error: f32,
) {
    let uv_bound = f64::from(pow2(UV_EXPONENT)) * 0.5 * 2f64.sqrt() + 1e-6;
    for (corner, &source) in indices.iter().enumerate() {
        let local = page.indices()[corner] as usize;
        let source = source as usize;
        let position = &page.attribute(0).expect("position")[local * 3..local * 3 + 3];
        assert!(distance(position, &positions[source * 3..source * 3 + 3]) <= f64::from(error));
        for attribute in attrs {
            // Ranks follow the page's fixed attribute order, present or not.
            let rank = 1 + codec::OPTIONAL
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
                                <= 0.5 / 256.0 + 1e-6
                        );
                    }
                    assert_eq!(decoded[local * 4 + 3], 1.0);
                }
                _ => assert!(distance(&decoded[local * 2..local * 2 + 2], expected) <= uv_bound),
            }
        }
    }
}

fn round_trip(vertices: usize, seed: u32) {
    let mut state = seed;
    let (indices, positions) = mesh(vertices, &mut state);
    let attrs = attributes(vertices, &mut state);
    let carried: Vec<&Attribute> = attrs.iter().collect();
    let encoded = encode(&indices, &positions, &carried, -9, UV_EXPONENT).expect("encode");
    let page = codec::decode(&encoded.bytes, 64 << 20).expect("decode");
    let header = &encoded.header;
    assert_eq!(page.flags, header.flags);
    assert_eq!(page.vertex_count, header.vertex_count);
    assert_eq!(page.decoded_bytes(), header.decoded_bytes());
    assert_eq!(page.quantization_error, header.quantization_error);
    assert_eq!(
        page.decoded_bytes(),
        header.vertex_count * (3 + 3 + 2 + 2 + 4) * 4 + indices.len() * 4
    );
    assert!(f64::from(header.quantization_error) <= f64::from(pow2(-9)) * 3f64.sqrt() * 0.5 + 1e-9);
    // Random vertices spend their full widths; a real cluster, tighter, spends fewer.
    if vertices >= 1024 {
        assert!(
            encoded.bytes.len() < page.decoded_bytes() / 2,
            "{} B packed",
            encoded.bytes.len()
        );
    }
    verify(&page, &indices, &positions, &attrs, page.quantization_error);
}

#[test]
fn golden_page_reread_within_its_declared_error() {
    for (vertices, seed) in [(3usize, 1u32), (17, 7), (1024, 99), (65_535, 424_242)] {
        round_trip(vertices, seed);
    }
}

/// A cluster of a regular grid (CMP-09): its corners, numbered by first use, cost well under the
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
    let encoded = encode(&indices, &positions, &[], -4, UV_EXPONENT).expect("encode");
    let fixed_bits = indices.len() * 7;
    let corner_bits = codec::Layout::of(&encoded.header).position[0] * 32;
    assert!(
        corner_bits * 10 < fixed_bits * 8,
        "{corner_bits} of {fixed_bits} bits"
    );
    let page = codec::decode(&encoded.bytes, 1 << 20).expect("decode");
    verify(&page, &indices, &positions, &[], 0.0);
}
