//! The quantization both ways (`bits/quant.rs`): a page attribute on its grid, a grid value back
//! to its float, and the error bound between the two the header carries.

use crate::bits::{dequant, pow2, quantization_error, quantize, Quant};
use trillion3d_math::golden::{f32s, Twin, Value};
use trillion3d_math::random::xorshift64;

pub(super) fn twins() -> [Twin; 3] {
    [
        Twin {
            file: "quantize",
            name: "quantize",
            about: "a page attribute on its grid of 2^exponent: each value divided by the step and rounded half away from zero, the page minimum and the bits of each component's range, then each vertex's offsets; no output when refused (page-codec-wasm bits/quant.rs quantize, the compiler's)",
            inputs: "exponent: i32, values: 3 f32 per vertex",
            outputs: "min: 3 f32, bits: 3 u32, offsets: 3 u32 per vertex; none when refused",
            cases: || attributes().into_iter().map(|(e, values)| quantize_inputs(e, &values)).collect(),
            compute: |v| {
                let values: Vec<f32> = v[1..].iter().map(|x| x.f32()).collect();
                let Ok((record, offsets)) = quantize::<3>(&values, v[0].i32()) else {
                    return Vec::new();
                };
                let mut out = f32s(&record.min);
                out.extend(record.bits.map(Value::U32));
                out.extend(offsets.iter().flatten().map(|&o| Value::U32(o)));
                out
            },
        },
        Twin {
            file: "quantize",
            name: "dequantize",
            about: "a grid value back to its float, min + q * step, the product exact and the sum rounded once (page-codec-wasm bits/quant.rs dequant, the page readers)",
            inputs: "min: f32, q: u32, step: f32",
            outputs: "1 f32",
            cases: dequant_cases,
            compute: |v| f32s(&[dequant(v[0].f32(), v[1].u32(), v[2].f32())]),
        },
        Twin {
            file: "quantize",
            name: "quantization_error",
            about: "the round trip's error bound a page header carries: the largest distance between a value and its dequantized offset, in f64, rounded up to an f32 (page-codec-wasm bits/quant.rs quantization_error)",
            inputs: "exponent: i32, min: 3 f32, then per vertex values: 3 f32 and offsets: 3 u32",
            outputs: "1 f32",
            cases: error_cases,
            compute: |v| {
                // The bound reads the minimum and the step, never the widths.
                let record = Quant {
                    min: [1, 2, 3].map(|c| v[c].f32()),
                    ..Quant::flat(v[0].i32())
                };
                let vertices = v[4..].as_chunks::<6>().0.iter();
                let values: Vec<f32> = vertices.clone().flat_map(|x| x[..3].iter().map(|c| c.f32())).collect();
                let offsets: Vec<[u32; 3]> = vertices.map(|x| [3, 4, 5].map(|c| x[c].u32())).collect();
                f32s(&[quantization_error::<3>(&values, &record, &offsets)])
            },
        },
    ]
}

/// Exponents against four-vertex attributes: halves of a cell, signed zeros, subnormals, ranges
/// past 2^24 cells, a minimum past the largest float.
fn attributes() -> Vec<(i32, Vec<f32>)> {
    let mut state = 1495;
    let mut unit = || (xorshift64(&mut state) >> 40) as f32 / (1u64 << 24) as f32;
    let mut sets: Vec<Vec<f32>> = vec![
        vec![
            0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 0.0, -0.0, 0.0, 1.0, 1.0, 1.0,
        ],
        vec![
            -0.0, 1e-45, -1e-40, 0.0, 0.0, 0.0, -0.0, -0.0, -0.0, 1e-38, 0.0, 0.0,
        ],
        vec![
            3.0e38, -3.0e38, 1.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 2.0, 2.0, 2.0,
        ],
        vec![1e6, -1e6, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
    ];
    sets.extend((0..8).map(|_| (0..12).map(|_| (unit() - 0.5) * 64.0).collect()));
    [-24, -12, -6, 0, 4, 20, 64]
        .into_iter()
        .flat_map(|e| sets.iter().map(move |values| (e, values.clone())))
        .collect()
}

fn quantize_inputs(exponent: i32, values: &[f32]) -> Vec<Value> {
    let mut inputs = vec![Value::I32(exponent)];
    inputs.extend(f32s(values));
    inputs
}

/// Hostile minima against the widest fields and the grid's extreme steps.
fn dequant_cases() -> Vec<Vec<Value>> {
    let minima = [
        0.0, -0.0, 1e-45, -1e-40, 1.0, -1.0, 0.1, -3.0e38, 3.4e38, -1234.5677,
    ];
    let mut cases = Vec::new();
    for min in minima {
        for q in [0u32, 1, 255, 65_535, (1 << 24) - 1] {
            for exponent in [-64, -24, -14, -8, 0, 8, 64] {
                cases.push(vec![
                    Value::F32(min),
                    Value::U32(q),
                    Value::F32(pow2(exponent)),
                ]);
            }
        }
    }
    cases
}

/// The quantized attributes the encoder accepts, each with its own record and offsets.
fn error_cases() -> Vec<Vec<Value>> {
    let mut cases = Vec::new();
    for (exponent, values) in attributes() {
        let Ok((record, offsets)) = quantize::<3>(&values, exponent) else {
            continue;
        };
        let mut case = vec![Value::I32(exponent)];
        case.extend(f32s(&record.min));
        for (vertex, cell) in values.as_chunks::<3>().0.iter().zip(&offsets) {
            case.extend(f32s(vertex));
            case.extend(cell.map(Value::U32));
        }
        cases.push(case);
    }
    cases
}
