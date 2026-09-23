//! Comparison bench of the native compiler's computations (lot B).
//!
//! For each optimised point, the bench keeps a copy of the previous implementation
//! (`reference_…`, French names) and runs it on exactly the same inputs as the
//! library. It first compares both results bit for bit, then measures the median
//! of each. Launch: `pnpm run bench:native`.
mod b1_world;
mod b2_manifest;
mod b3_bisection;
mod b3_border;
mod b4_capacities;
mod b5_page;
mod b5_topology;
mod b6_adjacency;
mod b9_vectors;
mod f_boxes;
mod f_scalars;
mod f_values;
mod fixture;
mod g10_preview;
mod g12_statistics;
mod g7_labels;
mod g9_accessor;
mod h3_proxy;
mod harness;
pub(crate) mod inputs;
mod report;

use harness::Row;

fn rows() -> Vec<Row> {
    let mut rows = vec![
        b1_world::row(),
        b2_manifest::row(),
        b3_bisection::row(),
        b3_border::row(),
    ];
    rows.extend(b4_capacities::rows());
    rows.push(b5_topology::row());
    rows.push(b5_page::row());
    // The hash table was measured at 52.0 ms against 28.8 ms for the global sort: dropped.
    // The row therefore compares the bench copy to an unchanged library and is the control.
    rows.push(b6_adjacency::row().spread(
        "hash table measured at 52.0 ms against 28.8 ms for the global sort, without SmallVec \
         which the Cargo.lock lock forbids: change dropped, the row is the bench control",
    ));
    rows.push(Row::note(
        "B7 reused SHA-256 digests",
        "compiler_primitive*.rs",
        "deferred: the only recomputation is re-reading an object already in cache, which \
         validates the persisted entry",
    ));
    rows.push(Row::note(
        "B8 CornerHasher by 32-bit words",
        "import.rs",
        "already done: write_u32 is already redefined",
    ));
    rows.push(b9_vectors::row().spread(
        "the gap between the bench copy and the library changes sign from one run to \
         another: no gain to prove, the attributes were not applied",
    ));
    rows.push(h3_proxy::row());
    rows.extend(formules());
    rows
}

/// Lot F — equivalence of the formulas factored into `shared_math.rs`. These rows
/// do not seek a gain: they prove that the one remaining copy yields the same bits
/// as each copy it replaces, hostile values included. A "no" row means rollback.
fn formules() -> Vec<Row> {
    let mut rows = vec![
        f_boxes::row_points(),
        f_boxes::row_boites(),
        f_boxes::row_simple(),
        f_boxes::row_bisection(),
        f_scalars::row_bourrage(),
        f_scalars::row_normalisation(),
    ];
    for row in &mut rows {
        if row.note.is_empty() {
            row.note = "factorisation to identical result: no gain expected".into();
        }
    }
    rows.push(Row::note(
        "F7 secondes vers millisecondes (elapsed_ms)",
        "shared_math.rs",
        "off-bench: the input is a measured duration, never twice the same; the formula is the \
         compiler's only `as_secs_f64() * 1000.0`, moved unchanged",
    ));
    rows
}

/// Lot G points carried by the native compiler. Their rows are written in the
/// JavaScript bench fragment format, so one table can assemble the twelve points of
/// the lot, without distinguishing what comes
/// from Rust from what comes from Node.
#[test]
#[ignore]
fn compute_bench_g() {
    let measured = vec![
        g7_labels::row(),
        g9_accessor::row(),
        g10_preview::row(),
        g12_statistics::row(),
    ];
    let table = report::table(&measured);
    report::write_fragment_g(&measured);
    println!("\n{table}");
    let ecarts: Vec<&str> = measured
        .iter()
        .filter(|row| row.identique == Some(false))
        .map(|row| row.calcul.as_str())
        .collect();
    assert!(ecarts.is_empty(), "different results: {ecarts:?}");
}

#[test]
#[ignore]
fn compute_bench() {
    let measured = rows();
    let table = report::table(&measured);
    report::write(&measured);
    let (total, path) = fixture::run();
    println!("\n{table}");
    println!("Golden fixtures: {total:.1} ms in total, survey in {path}\n");
    let ecarts: Vec<&str> = measured
        .iter()
        .filter(|row| row.identique == Some(false))
        .map(|row| row.calcul.as_str())
        .collect();
    assert!(ecarts.is_empty(), "different results: {ecarts:?}");
}
