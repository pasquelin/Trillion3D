//! One scene, one output whatever the run: its threads and RAM budget change how fast and
//! in how much memory a compile runs — the pool's width, the waves its primitives are cut into —
//! never the bytes it writes; the run's result reports them, the manifest head does not.
use super::deterministic::fingerprints;
use super::reuse::textured;
use super::*;
use crate::tests::compile::sparse_admission::two_grids;
use std::collections::BTreeMap;

/// The cache's files and the result of `options` compiled into a fresh cache under each
/// `(threads, ramBudgetMb)` of `runs`.
fn compiled_under(
    options: &Options,
    runs: [(usize, usize); 2],
) -> [(BTreeMap<PathBuf, String>, Value); 2] {
    runs.map(|(threads, ram_budget_mb)| {
        let _ = fs::remove_dir_all(&options.cache);
        let run = Options {
            threads,
            ram_budget_mb,
            ..options.clone()
        };
        let result = compile(&run, |_| {}).expect("compile");
        (fingerprints(&options.cache), result)
    })
}

// Behaviour: a textured scene and a scene of two primitives compiled on 1 and on 4 threads write
// the same files, byte for byte; each result reports the threads it ran on.
#[test]
fn one_and_four_threads_write_the_same_bytes() {
    for (root, options) in [textured(), two_grids()] {
        let [(one, single), (four, pooled)] = compiled_under(&options, [(1, 256), (4, 256)]);
        assert!(!one.is_empty(), "the compile wrote files");
        assert_eq!(one, four, "every file, by its SHA-256");
        assert_eq!(single["metrics"]["threads"], 1);
        assert_eq!(pooled["metrics"]["threads"], 4);
        fs::remove_dir_all(root).expect("cleanup");
    }
}

// Behaviour: under a small RAM budget the two primitives, whose kept page records leave no room for
// both, compile one wave each instead of being refused, under a large one together, and both
// write the same files, byte for byte; each result reports its budget and waves.
#[test]
fn a_small_and_a_large_ram_budget_write_the_same_bytes() {
    let (root, options) = two_grids();
    let [(small, tight), (large, roomy)] =
        compiled_under(&options, [(options.threads, 64), (options.threads, 1024)]);
    assert_eq!(tight["status"], "ready");
    assert!(
        tight["metrics"]["admissionEstimatedBytes"].as_u64() > Some(64 << 20),
        "{}",
        tight["metrics"]
    );
    assert_eq!(tight["metrics"]["compileWaves"], 2, "{}", tight["metrics"]);
    assert_eq!(roomy["metrics"]["compileWaves"], 1, "{}", roomy["metrics"]);
    assert_eq!(tight["metrics"]["ramBudgetMb"], 64);
    assert_eq!(roomy["metrics"]["ramBudgetMb"], 1024);
    assert!(!small.is_empty(), "the compile wrote files");
    assert_eq!(small, large, "every file, by its SHA-256");
    fs::remove_dir_all(root).expect("cleanup");
}
