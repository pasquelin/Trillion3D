//! YAML subset of Unity data files, split before the parser.
//!
//! A `.unity`, a `.prefab` or a `.mat` is a stream of documents whose header is not ordinary
//! YAML: `--- !u!<class> &<fileID>` and, for a prefab hook, the word `stripped` placed behind
//! the anchor. The `!u!` tag comes from a `%TAG` directive at the head of the file. The header
//! is therefore read here, line by line, and only the body of each document is handed to the
//! parser — YAML without a tag, which `yaml-rust2` (MIT OR Apache-2.0, version pinned in
//! `Cargo.toml`) reads as-is. Data only: no script, no code and no Unity library enters here.
use std::collections::BTreeMap;
use yaml_rust2::{yaml::Yaml, YamlLoader};

/// A serialized object: its Unity class, its body, and the `stripped` flag of a prefab hook
/// (the object is then only an attachment point, its content lives in the source prefab).
pub(super) struct Entry {
    pub(super) class_id: u32,
    pub(super) stripped: bool,
    /// Object body: the value under the type key.
    pub(super) body: Yaml,
}

/// A Unity data file: its objects, indexed by `fileID`, in file order.
pub(super) struct Document {
    pub(super) entries: BTreeMap<i64, Entry>,
    pub(super) order: Vec<i64>,
}

/// A Unity reference: `{fileID: n}` in the same file, `{fileID: n, guid: g, type: t}` toward
/// another asset.
#[derive(Clone, Default, PartialEq, Eq)]
pub(super) struct Ref {
    pub(super) file_id: i64,
    pub(super) guid: Option<String>,
}
impl Ref {
    pub(super) fn is_null(&self) -> bool {
        self.file_id == 0 && self.guid.is_none()
    }
}

impl Document {
    /// Splits the stream then reads each body. A document whose body does not read is left
    /// aside with its reason: a truncated file yields one document less, never a panic.
    pub(super) fn parse(text: &str, unreadable: &mut Vec<String>) -> Document {
        let mut entries = BTreeMap::new();
        let mut order = Vec::new();
        for (header, body) in split(text) {
            let Some((class_id, file_id, stripped)) = header_fields(header) else {
                unreadable.push(format!("unreadable header: {header}"));
                continue;
            };
            match YamlLoader::load_from_str(body) {
                Ok(documents) => match single_value(&documents) {
                    Some(body) => {
                        let entry = Entry {
                            class_id,
                            stripped,
                            body,
                        };
                        if entries.insert(file_id, entry).is_none() {
                            order.push(file_id);
                        }
                    }
                    None => unreadable.push(format!("empty body: fileID {file_id}")),
                },
                Err(error) => unreadable.push(format!("fileID {file_id}: {error}")),
            }
        }
        Document { entries, order }
    }
    pub(super) fn get(&self, file_id: i64) -> Option<&Entry> {
        self.entries.get(&file_id)
    }
    /// Objects of a given class, in file order.
    pub(super) fn of_class(&self, class_id: u32) -> impl Iterator<Item = (i64, &Entry)> {
        self.order.iter().filter_map(move |id| {
            let entry = self.entries.get(id)?;
            (entry.class_id == class_id).then_some((*id, entry))
        })
    }
}

/// Body of a Unity document: the value under its unique type key (`GameObject`, `Material`…).
fn single_value(documents: &[Yaml]) -> Option<Yaml> {
    let (_, value) = documents.first()?.as_hash()?.front()?;
    Some(value.clone())
}

/// (header, body) pairs of the stream. Everything that precedes the first `---` is a directive.
fn split(text: &str) -> Vec<(&str, &str)> {
    let mut out: Vec<(&str, usize, usize)> = Vec::new();
    let mut at = 0usize;
    for line in text.split_inclusive('\n') {
        let start = at;
        at += line.len();
        if !line.starts_with("---") {
            continue;
        }
        if let Some((_, _, end)) = out.last_mut() {
            *end = start;
        }
        out.push((line.trim_end(), at, text.len()));
    }
    out.into_iter()
        .map(|(header, start, end)| (header, &text[start..end]))
        .collect()
}

/// `--- !u!1 &100`, `--- !u!1001 &1234 stripped`: class, fileID, and the object is only a hook.
fn header_fields(header: &str) -> Option<(u32, i64, bool)> {
    let (mut class_id, mut file_id, mut stripped) = (None, None, false);
    for word in header.trim_start_matches('-').split_whitespace() {
        if let Some(rest) = word.strip_prefix("!u!") {
            class_id = rest.parse::<u32>().ok();
        } else if let Some(rest) = word.strip_prefix('&') {
            file_id = rest.parse::<i64>().ok();
        } else if word == "stripped" {
            stripped = true;
        }
    }
    Some((class_id?, file_id?, stripped))
}

/// A number, whether Unity wrote it as integer, float or in quotes.
pub(super) fn number(value: &Yaml) -> Option<f64> {
    match value {
        Yaml::Integer(n) => Some(*n as f64),
        Yaml::Real(text) | Yaml::String(text) => text.parse::<f64>().ok(),
        Yaml::Boolean(flag) => Some(f64::from(u8::from(*flag))),
        _ => None,
    }
}
/// A named number, or the default when the property is not written.
pub(super) fn number_at(value: &Yaml, key: &str, default: f64) -> f64 {
    number(&value[key]).unwrap_or(default)
}
/// `{x: .., y: .., z: ..}`.
pub(super) fn vec3(value: &Yaml, default: [f64; 3]) -> [f64; 3] {
    [
        number_at(value, "x", default[0]),
        number_at(value, "y", default[1]),
        number_at(value, "z", default[2]),
    ]
}
/// `{x, y, z, w}` of a Unity quaternion, or `{r, g, b, a}` of a colour.
pub(super) fn vec4(value: &Yaml, keys: [&str; 4], default: [f64; 4]) -> [f64; 4] {
    [
        number_at(value, keys[0], default[0]),
        number_at(value, keys[1], default[1]),
        number_at(value, keys[2], default[2]),
        number_at(value, keys[3], default[3]),
    ]
}
/// Text of a scalar, whatever way the parser stored it. A Unity GUID is a sequence of
/// thirty-two hexadecimal digits: `0000000000000000e000000000000000` looks like a number in
/// scientific notation and therefore arrives as `Real`, whose original text is kept. Reading it
/// by `as_str` alone would leave the reference without its GUID.
pub(super) fn text(value: &Yaml) -> Option<String> {
    match value {
        Yaml::String(value) | Yaml::Real(value) => Some(value.clone()),
        Yaml::Integer(value) => Some(value.to_string()),
        _ => None,
    }
}

/// A sixty-four-bit integer, read as such. Passing it through a float would damage it beyond
/// 2^53, and a real project carries some — `33000010677178610` would then name an object that
/// does not exist, and the component it names stays invisible. Unity writes its identifiers
/// signed, and some beyond `i64::MAX` unsigned: both name the same object.
pub(super) fn integer(value: &Yaml) -> Option<i64> {
    match value {
        Yaml::Integer(value) => Some(*value),
        Yaml::Real(text) | Yaml::String(text) => text
            .parse::<i64>()
            .ok()
            .or_else(|| text.parse::<u64>().ok().map(|value| value as i64)),
        _ => None,
    }
}

/// A reference `{fileID: …, guid: …}`.
pub(super) fn reference(value: &Yaml) -> Ref {
    Ref {
        file_id: integer(&value["fileID"]).unwrap_or(0),
        guid: text(&value["guid"]),
    }
}
/// Elements of a sequence, empty when the property is not a sequence.
pub(super) fn sequence<'a>(value: &'a Yaml, key: &str) -> &'a [Yaml] {
    value[key].as_vec().map_or(&[], Vec::as_slice)
}
/// Unity writes its property tables as a sequence of single-key mappings (`- _Metallic: 0.25`).
/// Yields the value of the first entry carrying this name.
pub(super) fn named<'a>(list: &'a [Yaml], name: &str) -> Option<&'a Yaml> {
    list.iter().find_map(|item| {
        let hash = item.as_hash()?;
        let (key, value) = hash.front()?;
        (key.as_str()? == name).then_some(value)
    })
}
