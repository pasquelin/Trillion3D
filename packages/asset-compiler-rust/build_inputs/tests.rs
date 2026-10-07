use super::declarations::{declarations, Declaration};
use super::manifest::dependency_paths;
use super::{path_dependencies, production_sources};
use std::path::{Path, PathBuf};

// Behaviour: a path dependency is found however the manifest writes it — inline at any spacing,
// an inline table over several lines, a dotted key, a table of its own, a target's —, and a
// test-only one, a comment, a string or a `path` that names no dependency is not.
#[test]
fn every_way_of_writing_a_path_dependency_is_read() {
    let manifest = r#"
[package]
name = "compiler"
description = """
[dependencies]
fake = { path = "../in-a-string" }
"""
[lib]
path = "src/lib.rs"

[dependencies]
spaced = { path = "../spaced" }
tight = {path="../tight", version="1"}
broken = {
    version = "1", # a comment
    path = "../broken",
}
dotted.path = "../dotted"
path = "1.0"
# commented = { path = "../commented" }
remote = { version = "1", features = ["a", "b"] }

[dependencies.table]
version = "1"
path = "../table"

[build-dependencies.built]
path = '../built'

[target.'cfg(unix)'.dependencies]
unix = { path = "../unix" }

[dev-dependencies]
tested = { path = "../tested" }

[dev-dependencies.tested-table]
path = "../tested-table"
"#;
    assert_eq!(
        dependency_paths(manifest),
        [
            "../spaced",
            "../tight",
            "../broken",
            "../dotted",
            "../table",
            "../built",
            "../unix"
        ]
    );
}

fn read(file: &str, text: &str) -> Vec<(PathBuf, bool, bool)> {
    declarations(Path::new(file), text)
        .into_iter()
        .map(
            |Declaration {
                 module,
                 exact,
                 test,
             }| (module, exact, test),
        )
        .collect()
}

// Behaviour: a `mod` in a comment, nested or not, or in a string, raw or not, declares nothing;
// one after a character literal holding a quote does.
#[test]
fn comments_and_strings_declare_nothing() {
    let text = r##"
// mod line;
/* mod block; /* mod nested; */ mod still_comment; */
const A: &str = "mod quoted;";
const B: &str = r#"mod raw; "# ;
const C: char = '"';
const D: char = '\'';
mod after;
"##;
    assert_eq!(
        read("src/lib.rs", text),
        [(PathBuf::from("src/after"), false, false)]
    );
}

// Behaviour: `#[path]` is read whatever its spacing, from the folder of the declaring file.
#[test]
fn a_path_attribute_is_read_at_any_spacing() {
    let text = "#[path=\"x/y.rs\"] mod tight;\n#[ path = \"../z.rs\" ]\npub(crate) mod spaced;";
    assert_eq!(
        read("src/a/b.rs", text),
        [
            (PathBuf::from("src/a/x/y.rs"), true, false),
            (PathBuf::from("src/z.rs"), true, false),
        ]
    );
}

// Behaviour: a module declared inside an inline one is under its folder — from a `lib.rs` as from
// a named file —, a `#[path]` inside it too.
#[test]
fn inline_modules_are_followed() {
    let text = "mod a { fn f() {} mod x; #[path = \"p.rs\"] mod y; }\nmod z;";
    assert_eq!(
        read("src/lib.rs", text),
        [
            (PathBuf::from("src/a/x"), false, false),
            (PathBuf::from("src/a/p.rs"), true, false),
            (PathBuf::from("src/z"), false, false),
        ]
    );
    assert_eq!(
        read("src/k.rs", "pub mod a { mod x; }"),
        [(PathBuf::from("src/k/a/x"), false, false)]
    );
}

// Behaviour: `#[cfg(test)]` at any spacing gates its module, and an inline module's gate holds for
// what it declares, to the deepest, not for what follows it.
#[test]
fn a_test_gate_holds_for_the_inline_modules_inside() {
    let text = "#[cfg( test )]\nmod spaced;\nmod outer {\n#[cfg(test)]\nmod t { mod u { mod deep; } }\nmod plain;\n}";
    assert_eq!(
        read("src/lib.rs", text),
        [
            (PathBuf::from("src/spaced"), false, true),
            (PathBuf::from("src/outer/t/u/deep"), false, true),
            (PathBuf::from("src/outer/plain"), false, false),
        ]
    );
}

// Behaviour: the compiler links the page codec and the maths, each once, the maths reached through
// the codec as well as directly; the maths' golden harness and tests are no production source.
#[test]
fn the_compiler_links_the_codec_and_the_maths_without_their_tests() {
    assert_eq!(
        path_dependencies().unwrap(),
        [
            PathBuf::from("../math/rust"),
            PathBuf::from("../page-codec-wasm")
        ]
    );
    let mut sources = Vec::new();
    production_sources(Path::new("../math/rust"), &mut sources).unwrap();
    assert!(sources.contains(&PathBuf::from("../math/rust/src/lib.rs")));
    for test in [
        "golden.rs",
        "golden/value.rs",
        "golden_tests.rs",
        "js_tests.rs",
    ] {
        let test = Path::new("../math/rust/src").join(test);
        assert!(!sources.contains(&test), "{}", test.display());
    }
}
