//! The corpus, family by family: every case on two seeds, every invariant, and a panic named
//! after the case that raised it.
use super::*;
use std::panic::{catch_unwind, AssertUnwindSafe};

const SEEDS: [u64; 2] = [1, 7];

fn run(family: Vec<(Generator, Expect)>) {
    for (generate, expect) in family {
        for seed in SEEDS {
            let case = generate(seed);
            let label = format!("{} (seed {seed})", case.name);
            let outcome = catch_unwind(AssertUnwindSafe(|| {
                let mut roots = Vec::new();
                for indices in case.primitives() {
                    let built = invariants::build(&case, &indices);
                    invariants::check_structure(&case, &indices, &built, &label);
                    islands::check_islands(&case, &indices, &built, &label);
                    invariants::check_roots(expect.roots, &built, &label);
                    invariants::check_pages(&case, &built, &label);
                    roots.push(built.roots());
                }
                cache::check_cache(&case, &expect, &roots, &label);
            }));
            if let Err(panic) = outcome {
                let message = panic
                    .downcast_ref::<String>()
                    .cloned()
                    .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                    .unwrap_or_default();
                panic!("{label}: {message}");
            }
        }
    }
}

#[test]
fn uv_layouts_are_explained() {
    run([uv::cases(), uv_degenerate::cases()].concat());
}

#[test]
fn attributes_are_explained() {
    run(attributes::cases());
}

#[test]
fn topologies_are_explained() {
    run(topology::cases());
}

#[test]
fn materials_are_explained() {
    run(materials::cases());
}

#[test]
fn inputs_are_explained() {
    run(inputs::cases());
}
