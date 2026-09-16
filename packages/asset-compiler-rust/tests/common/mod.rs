//! Helpers shared by the executable's end-to-end test binaries.
#![allow(dead_code)]
use serde_json::Value;
use std::{fs, path::PathBuf};

/// A source tree holding one quad and an empty cache directory, both under a per-tag temporary root.
pub fn fixture(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root =
        std::env::temp_dir().join(format!("web-geometry-cli-{}-{}", std::process::id(), tag));
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
