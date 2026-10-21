//! Path safety: a source file name is one relative segment, and a path under a root never leaves
//! it — the one rule of a served resource and of an archive entry.
use std::path::Path;

/// The directory holding `file`, or `.` when its path names none.
pub(crate) fn parent_or_dot(file: &Path) -> &Path {
    file.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

/// Whether `name` is one relative path segment, as a source file and its sidecar must be: no
/// `../../`, `\`, `..` or NUL, under 256 bytes. Anything else, a path escape first, is refused.
pub(crate) fn is_safe_source_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 256
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && !name.contains('\0')
}
/// A path under a root, sanitized: the one rule of a resource under the served root and of an
/// archive entry under its extraction root. An absolute path, a path naming a volume, or one with
/// an unsafe segment — climbing above the root — has none: the resource is counted missing, the
/// entry refused, rather than read or written outside. A `.` segment names nothing and is
/// skipped (`a/./b` is `a/b`); a path left with no segment has none. `separators` specifies
/// segment separators in the original format.
pub(crate) fn safe_relative(file: &str, separators: &[char]) -> Option<String> {
    if file.starts_with('/') || file.contains(':') {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in file
        .split(separators)
        .filter(|part| !part.is_empty() && *part != ".")
    {
        if !is_safe_source_name(part) {
            return None;
        }
        parts.push(part);
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::safe_relative;

    // Behaviour: a path under a root keeps its segments, skips `.`, and has none once it climbs,
    // starts at the top, names a volume, carries a separator the format does not use, or is empty.
    #[test]
    fn a_path_under_a_root_skips_dots_and_never_leaves_it() {
        assert_eq!(safe_relative("a/./b", &['/']).as_deref(), Some("a/b"));
        assert_eq!(safe_relative("./a//b/.", &['/']).as_deref(), Some("a/b"));
        assert_eq!(safe_relative("a\\b", &['/', '\\']).as_deref(), Some("a/b"));
        for refused in [
            "../a", "a/../b", "a/..", "/a", "C:a", "a\\b", ".", "../../", "",
        ] {
            assert_eq!(safe_relative(refused, &['/']), None, "{refused:?}");
        }
    }
}
