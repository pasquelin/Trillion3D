//! Helpers shared by the executable's end-to-end test binaries.
#![allow(dead_code)]
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
};

/// A source tree holding one quad and an empty cache directory, both under a per-tag temporary root.
pub fn fixture(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("trillion3d-cli-{}-{}", std::process::id(), tag));
    let source = root.join("source");
    let cache = root.join("cache");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&source).expect("source");
    fs::write(
        source.join("quad.obj"),
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvn 0 0 1\nf 1//1 2//1 4//1 3//1\n",
    )
    .expect("obj");
    (root, source.join("quad.obj"), cache)
}
pub fn lines(text: &str) -> Vec<Value> {
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap_or_else(|_| panic!("not JSON: {l}")))
        .collect()
}

/// A heavier source than the quad: a grid of `side × side` quads, large enough for compilation
/// to still be running when another process checks it holding the cache lock.
pub fn grid_fixture(tag: &str, side: usize) -> (PathBuf, PathBuf, PathBuf) {
    let (root, quad, cache) = fixture(tag);
    let grid = quad.with_file_name("grille.obj");
    fs::remove_file(&quad).expect("quad");
    fs::write(&grid, grid_obj(side)).expect("obj");
    (root, grid, cache)
}
fn grid_obj(side: usize) -> String {
    let mut text = String::new();
    for y in 0..=side {
        for x in 0..=side {
            text.push_str(&format!("v {x} {y} 0\n"));
        }
    }
    text.push_str("vn 0 0 1\n");
    let rank = |x: usize, y: usize| y * (side + 1) + x + 1;
    for y in 0..side {
        for x in 0..side {
            let (a, b) = (rank(x, y), rank(x + 1, y));
            let (c, d) = (rank(x + 1, y + 1), rank(x, y + 1));
            text.push_str(&format!("f {a}//1 {b}//1 {c}//1 {d}//1\n"));
        }
    }
    text
}

/// Command line for a single job: source, cache, then settings that lock tests do not vary.
pub fn compiler(source: &Path, cache: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_trillion3d-compiler"));
    command.args([
        source.to_str().expect("source"),
        cache.to_str().expect("cache"),
        "full",
        "150000",
        "1",
        "2048",
        "/assets/",
        "none",
    ]);
    command
}

/// Runs a job without input and returns its output once it has succeeded; a failure shows the
/// program's stderr.
pub fn run_ok(command: &mut Command) -> Output {
    let output = command.stdin(Stdio::null()).output().expect("run");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output
}
