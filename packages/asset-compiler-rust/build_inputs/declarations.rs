//! The `mod name;` declarations of a Rust source, read past its comments and its strings.

use super::code::{blanked, word};
use super::normal;
use std::path::{Path, PathBuf};

/// A `mod name;` of a source: the module it names — a file under `#[path]`, else the path of
/// `name.rs` and `name/` without extension — and whether `#[cfg(test)]` gates it or an inline
/// module around it.
pub struct Declaration {
    pub module: PathBuf,
    pub exact: bool,
    pub test: bool,
}

impl Declaration {
    pub fn covers(&self, file: &Path) -> bool {
        match self.exact {
            true => file == self.module,
            false => file == self.module.with_extension("rs") || file.starts_with(&self.module),
        }
    }
}

/// What the attributes in `head` say: the `#[path]` string, if any, and whether `#[cfg(test)]` is
/// among them, whatever their spacing.
fn attributes(
    code: &[char],
    head: std::ops::Range<usize>,
    strings: &[(usize, String)],
) -> (Option<String>, bool) {
    let (mut path, mut test) = (None, false);
    let mut at = head.start;
    while at + 1 < head.end {
        if code[at] != '#' || code[at + 1] != '[' {
            at += 1;
            continue;
        }
        let mut depth = 0;
        let end = (at + 1..head.end).find(|&i| {
            depth += match code[i] {
                '[' => 1,
                ']' => -1,
                _ => 0,
            };
            depth == 0
        });
        let end = end.unwrap_or(head.end);
        let inside: String = code[at + 2..end]
            .iter()
            .filter(|c| !c.is_whitespace())
            .collect();
        test |= inside == "cfg(test)";
        if inside.starts_with("path=\"") {
            let quote = (at + 2..end).find(|&i| code[i] == '"');
            path = quote
                .and_then(|q| strings.iter().find(|(at, _)| *at == q))
                .map(|(_, s)| s.clone());
        }
        at = end;
    }
    (path, test)
}

/// An inline module being read: where its children's files are, and whether test code it is.
struct Scope {
    dir: PathBuf,
    test: bool,
}

/// The `mod name;` declarations of `file`, inline `mod a { … }` followed into: `mod x;` inside it
/// is `a/x`, and a `#[cfg(test)]` on it holds for what it declares. The attributes read are those
/// between the declaration and the item before it.
pub fn declarations(file: &Path, text: &str) -> Vec<Declaration> {
    let here = file.parent().unwrap_or(Path::new(""));
    let stem = file
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("");
    let dir = match stem {
        "lib" | "main" | "mod" => here.to_path_buf(),
        _ => file.with_extension(""),
    };
    let (code, strings) = blanked(text);
    // Each open brace: the inline module it opens, or none.
    let mut scopes: Vec<Option<Scope>> = Vec::new();
    let mut out = Vec::new();
    let (mut item, mut at) = (0, 0);
    while at < code.len() {
        match code[at] {
            '{' => scopes.push(None),
            '}' => drop(scopes.pop()),
            ';' => {}
            'm' if code[at..].starts_with(&['m', 'o', 'd'])
                && !(at > 0 && word(code[at - 1]))
                && code.get(at + 3).is_some_and(|c| c.is_whitespace()) =>
            {
                let start = (at + 3..code.len())
                    .find(|&i| !code[i].is_whitespace())
                    .unwrap_or(code.len());
                let end = (start..code.len())
                    .find(|&i| !word(code[i]))
                    .unwrap_or(code.len());
                let then = (end..code.len()).find(|&i| !code[i].is_whitespace());
                let name: String = code[start..end].iter().collect();
                let (path, gated) = attributes(&code, item..at, &strings);
                let inner = scopes.iter().rev().find_map(Option::as_ref);
                let test = gated || inner.is_some_and(|scope| scope.test);
                let base = inner.map_or(dir.as_path(), |scope| scope.dir.as_path());
                let open = match then.map(|i| code[i]) {
                    Some(c @ (';' | '{')) if end > start => c == '{',
                    _ => {
                        at += 1;
                        continue;
                    }
                };
                // A `#[path]` outside every inline module is from the file's folder, on an inline
                // module as on a file one and whatever the file's name: rustc keeps no folder of a
                // named file's stem there. Inside an inline module, from the folder of its children.
                let from = |path: &str| normal(&inner.map_or(here, |_| base).join(path));
                let module = path.as_deref().map_or_else(|| base.join(&name), from);
                if open {
                    scopes.push(Some(Scope { dir: module, test }));
                } else {
                    out.push(Declaration {
                        module,
                        exact: path.is_some(),
                        test,
                    });
                }
                at = then.map_or(code.len(), |i| i + 1);
                item = at;
                continue;
            }
            _ => {
                at += 1;
                continue;
            }
        }
        at += 1;
        item = at;
    }
    out
}
