//! The grid rules of a primitive (`bits/grid.rs`), the compiler's and the run-time cut's: the
//! finest grid a span fits, a tile's width, the position grid and the texture grid.

use crate::bits::grid::{finest_exponent, primitive_grid_exponent, tile_log2, uv_grid_exponent};
use trillion3d_math::golden::{f64s, ordinary, Twin, Value, HOSTILE_F64};

pub(crate) fn twins() -> [Twin; 4] {
    [
        Twin {
            file: "grid",
            name: "finest_exponent",
            about: "the finest grid on which a positive span fits a page's field, at most 2^23 steps: ceil(log2(span)) - 23 by Rust's saturating `as i32`, clamped to ±64 (page-codec-wasm bits/grid.rs finest_exponent, page-codec gridExponent.ts finestExponent)",
            inputs: "span: f64",
            outputs: "1 i32",
            cases: finest_cases,
            compute: |v| vec![Value::I32(finest_exponent(v[0].f64()))],
        },
        Twin {
            file: "grid",
            name: "tile_log2",
            about: "a tile's width, 2 m of the world, as a power of two in the object units the largest world scale gives, rounded down; a missing, zero or non-finite scale a metre per unit (page-codec-wasm bits/grid.rs tile_log2, page-codec gridExponent.ts tileLog2)",
            inputs: "has_scale: u32 (0 none), scale: f64",
            outputs: "1 i32",
            cases: tile_cases,
            compute: |v| vec![Value::I32(tile_log2(scale(v)))],
        },
        Twin {
            file: "grid",
            name: "primitive_grid_exponent",
            about: "the position grid of a primitive: a blended one the finest its pages hold, any other its widest extent capped at its tile in 2^16 steps or an eighth of its DAG's finest error, the finer, never finer than its widest page fits (page-codec-wasm bits/grid.rs primitive_grid_exponent and grid_exponent, page-codec gridExponent.ts primitiveGridExponent)",
            inputs: "extent: f64, has_error: u32 (0 none), finest_error: f64, blended: u32, tile_log2: i32",
            outputs: "1 i32",
            cases: primitive_cases,
            compute: |v| {
                let error = (v[1].u32() != 0).then(|| v[2].f64());
                let exponent =
                    primitive_grid_exponent(v[0].f64(), error, v[3].u32() != 0, v[4].i32());
                vec![Value::I32(exponent)]
            },
        },
        Twin {
            file: "grid",
            name: "uv_grid_exponent",
            about: "the texture grid of a primitive whose texture coordinates span `span`: the format's 2^-14, or for a blended one the finest grid that span fits, never coarser (page-codec-wasm bits/grid.rs uv_grid_exponent, page-codec gridExponent.ts uvGridExponent)",
            inputs: "span: f64, blended: u32",
            outputs: "1 i32",
            cases: uv_cases,
            compute: |v| vec![Value::I32(uv_grid_exponent(v[0].f64(), v[1].u32() != 0))],
        },
    ]
}

fn scale(v: &[Value]) -> Option<f64> {
    (v[0].u32() != 0).then(|| v[1].f64())
}

/// Spans and extents: the hostile values, the extremes of the field, and the documented ones of the
/// rules' own tests (`tile_tests.rs`, `tile_quantum_tests.rs`): a 32 m hall, a kilometre terrain in
/// metres and in kilometres, a 3,720-unit hall, a 4096 texture.
fn spans() -> Vec<f64> {
    let mut spans = HOSTILE_F64.to_vec();
    spans.extend([
        5e-324,
        f64::MIN_POSITIVE,
        f64::MAX,
        1e-300,
        1e-30,
        1.024,
        32.0,
        63.999,
        64.0,
        1024.0,
        3720.0,
        4096.0,
        1_048_576.0,
    ]);
    spans
}

/// Powers of two and their two neighbours, where a rounded logarithm changes its integer.
fn powers_of_two() -> Vec<f64> {
    [
        -1074, -1022, -100, -24, -23, -1, 0, 1, 10, 23, 24, 100, 1023,
    ]
    .into_iter()
    .flat_map(|k| {
        // 2^k by its bits: `powi` would underflow on the way to a subnormal.
        let power = f64::from_bits(if k < -1022 {
            1 << (k + 1074)
        } else {
            ((k + 1023) as u64) << 52
        });
        [power.next_down(), power, power.next_up()]
    })
    .collect()
}

/// A sweep of spans from 2^-100 to 2^100.
fn sweep(n: u64) -> impl Iterator<Item = f64> {
    (0..n).map(|i| ordinary(i).exp2())
}

fn finest_cases() -> Vec<Vec<Value>> {
    let spans = spans().into_iter().chain(powers_of_two()).chain(sweep(128));
    spans.map(|span| f64s(&[span])).collect()
}

fn tile_cases() -> Vec<Vec<Value>> {
    let scales = spans()
        .into_iter()
        .chain([0.008, 1e3, 0.5, 2.0, 4.0])
        .chain((0..64).map(|i| (ordinary(i) / 4.0).exp2()));
    let mut cases = vec![vec![Value::U32(0), Value::F64(0.0)]];
    cases.extend(scales.map(|scale| vec![Value::U32(1), Value::F64(scale)]));
    cases
}

/// The tiles of the rules' tests: a metre per unit, none reached, a 0.008 and a 1,000 scale, and
/// the finest a normal scale gives.
const TILES: [i32; 5] = [1, i32::MAX, 7, -9, -1023];

fn primitive_case(extent: f64, error: Option<f64>, blended: bool, tile: i32) -> Vec<Value> {
    vec![
        Value::F64(extent),
        Value::U32(error.is_some().into()),
        Value::F64(error.unwrap_or(0.0)),
        Value::U32(blended.into()),
        Value::I32(tile),
    ]
}

/// Every extent against every error on the tile of a metre, every extent on the other tiles with no
/// error, both blended and not, then a sweep of extents, errors and tiles.
fn primitive_cases() -> Vec<Vec<Value>> {
    let errors = [
        None,
        Some(0.0),
        Some(-0.0),
        Some(f64::NAN),
        Some(f64::INFINITY),
        Some(5e-324),
        Some(1e-300),
        Some(1e-3),
        Some(0.5),
        Some(16.0),
        Some(1e308),
    ];
    let mut cases = Vec::new();
    for extent in spans() {
        for blended in [false, true] {
            for error in errors {
                cases.push(primitive_case(extent, error, blended, TILES[0]));
            }
            for tile in &TILES[1..] {
                cases.push(primitive_case(extent, None, blended, *tile));
            }
        }
    }
    for i in 0..256u64 {
        let error = match i % 3 {
            0 => None,
            1 => Some((ordinary(i + 1000) / 3.0).exp2()),
            _ => Some(0.0),
        };
        let extent = (ordinary(i) / 2.0).exp2();
        cases.push(primitive_case(
            extent,
            error,
            i % 2 == 1,
            TILES[i as usize % 5],
        ));
    }
    cases
}

fn uv_cases() -> Vec<Vec<Value>> {
    let spans = spans().into_iter().chain(powers_of_two()).chain(sweep(64));
    spans
        .flat_map(|span| [0, 1].map(|blended| vec![Value::F64(span), Value::U32(blended)]))
        .collect()
}
