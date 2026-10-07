//! The reference values the Rust, TypeScript and WGSL twins are held to,
//! `packages/math/golden/<file>.json`: one section per twin (an encoder and its decoder share a
//! file), each case its inputs and the Rust twin's outputs by their exact bits (`value.rs`).
//!
//! Layout: one case per line, read line by line, so Prettier never reformats the folder.
//! Each owning crate calls `run` from one test: it checks, or writes with `GOLDEN_WRITE=1`.

use std::fmt::Write as _;
use std::path::PathBuf;

mod value;
pub use value::{f32s, f64s, ordinary, Value, HOSTILE_F64};

const REGENERATE: &str = "pnpm run golden:write";
const LAYOUT: &str = "one case per line, read line by line: never reformatted";

/// A mirrored primitive: its file and section, the section's description, its cases' inputs, and
/// the Rust twin that answers them.
pub struct Twin {
    pub file: &'static str,
    pub name: &'static str,
    pub about: &'static str,
    pub inputs: &'static str,
    pub outputs: &'static str,
    pub cases: fn() -> Vec<Vec<Value>>,
    pub compute: fn(&[Value]) -> Vec<Value>,
}

/// Writes each file of `twins` when `GOLDEN_WRITE` is `1`, else checks every case of each.
pub fn run(twins: &[Twin]) {
    let write = std::env::var_os("GOLDEN_WRITE").is_some_and(|v| v == "1");
    let mut files: Vec<&str> = Vec::new();
    for twin in twins {
        if !files.contains(&twin.file) {
            files.push(twin.file);
        }
    }
    for file in files {
        let sections: Vec<&Twin> = twins.iter().filter(|t| t.file == file).collect();
        if write {
            let text = text(&sections).expect("a string takes any write");
            std::fs::write(path(file), text).expect("the golden folder is writable");
        } else {
            check(file, &sections);
        }
    }
}

fn path(file: &str) -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../golden")).join(format!("{file}.json"))
}

fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('\\', "\\\\").replace('"', "\\\""))
}

/// A file's text, its outputs those its Rust twins return.
fn text(sections: &[&Twin]) -> Result<String, std::fmt::Error> {
    let list = |values: &[Value]| {
        let tokens: Vec<String> = values.iter().map(|v| quoted(&v.token())).collect();
        tokens.join(", ")
    };
    let mut text = String::from("{\n");
    writeln!(text, "  \"layout\": {},", quoted(LAYOUT))?;
    writeln!(text, "  \"regenerate\": {},", quoted(REGENERATE))?;
    for (at, twin) in sections.iter().enumerate() {
        writeln!(text, "  {}: {{", quoted(twin.name))?;
        for (key, value) in [
            ("about", twin.about),
            ("inputs", twin.inputs),
            ("outputs", twin.outputs),
        ] {
            writeln!(text, "    \"{key}\": {},", quoted(value))?;
        }
        text.push_str("    \"cases\": [\n");
        let cases = (twin.cases)();
        for (k, inputs) in cases.iter().enumerate() {
            let comma = if k + 1 < cases.len() { "," } else { "" };
            let (inputs, outputs) = (list(inputs), list(&(twin.compute)(inputs)));
            writeln!(
                text,
                "      {{\"in\": [{inputs}], \"out\": [{outputs}]}}{comma}"
            )?;
        }
        let comma = if at + 1 < sections.len() { "," } else { "" };
        writeln!(text, "    ]\n  }}{comma}")?;
    }
    text.push_str("}\n");
    Ok(text)
}

/// Asserts that each section's twin returns every expected output of its cases, bit for bit.
fn check(file: &str, sections: &[&Twin]) {
    let text = std::fs::read_to_string(path(file)).expect("the golden file exists");
    let mut cases = vec![0usize; sections.len()];
    let mut current = None;
    for line in text.lines().map(str::trim) {
        // The quoted strings of the line: a section's name, or `in`, its values, `out`, its values.
        let tokens: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
        if line.ends_with(": {") {
            let at = sections.iter().position(|t| t.name == tokens[0]);
            current = Some(at.unwrap_or_else(|| panic!("{file}: no twin for {}", tokens[0])));
            continue;
        }
        if !line.starts_with("{\"in\":") {
            continue;
        }
        let at = current.unwrap_or_else(|| panic!("{file}: a case outside a section"));
        let (name, compute) = (sections[at].name, sections[at].compute);
        let out = tokens
            .iter()
            .position(|&t| t == "out")
            .expect("an output list");
        let inputs: Vec<Value> = tokens[1..out].iter().map(|t| Value::parse(t)).collect();
        let expected = tokens[out + 1..].iter().map(|t| Value::parse(t));
        let actual = compute(&inputs);
        let same =
            expected.len() == actual.len() && expected.zip(&actual).all(|(e, a)| e.matches(*a));
        let got: Vec<String> = actual.iter().map(|v| v.token()).collect();
        assert!(same, "{file} {name}: {line} returns {got:?}");
        cases[at] += 1;
    }
    for (twin, count) in sections.iter().zip(cases) {
        assert!(count > 0, "{file} {}: no case", twin.name);
    }
}
