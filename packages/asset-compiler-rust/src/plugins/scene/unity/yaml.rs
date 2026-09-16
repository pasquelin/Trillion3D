//! Le sous-ensemble YAML des fichiers de données Unity, découpé avant le parseur.
//!
//! Un `.unity`, un `.prefab` ou un `.mat` est un flux de documents dont l'entête n'est pas du YAML
//! ordinaire : `--- !u!<classe> &<fileID>` et, pour une accroche de prefab, le mot `stripped` posé
//! derrière l'ancre. Le tag `!u!` vient d'une directive `%TAG` en tête de fichier. On lit donc
//! l'entête soi-même, ligne par ligne, et on ne confie au parseur que le corps de chaque document —
//! du YAML sans tag, que `yaml-rust2` (MIT OU Apache-2.0, version figée dans `Cargo.toml`) lit tel
//! quel. Données seulement : aucun script, aucun code et aucune bibliothèque Unity n'entre ici.
use std::collections::BTreeMap;
use yaml_rust2::{yaml::Yaml, YamlLoader};

/// Un objet sérialisé : sa classe Unity, son corps, et le drapeau `stripped` d'une accroche de
/// prefab (l'objet n'est alors qu'un point d'attache, son contenu vit dans le prefab source).
pub(super) struct Entry {
    pub(super) class_id: u32,
    pub(super) stripped: bool,
    /// Le corps de l'objet : la valeur sous la clé de type.
    pub(super) body: Yaml,
}

/// Un fichier de données Unity : ses objets, indexés par `fileID`, dans l'ordre du fichier.
pub(super) struct Document {
    pub(super) entries: BTreeMap<i64, Entry>,
    pub(super) order: Vec<i64>,
}

/// Une référence Unity : `{fileID: n}` dans le même fichier, `{fileID: n, guid: g, type: t}` vers
/// un autre asset.
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
    /// Découpe le flux puis lit chaque corps. Un document dont le corps ne se lit pas est laissé de
    /// côté avec sa raison : un fichier tronqué rend un document de moins, jamais une panique.
    pub(super) fn parse(text: &str, unreadable: &mut Vec<String>) -> Document {
        let mut entries = BTreeMap::new();
        let mut order = Vec::new();
        for (header, body) in split(text) {
            let Some((class_id, file_id, stripped)) = header_fields(header) else {
                unreadable.push(format!("entête illisible: {header}"));
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
                    None => unreadable.push(format!("corps vide: fileID {file_id}")),
                },
                Err(error) => unreadable.push(format!("fileID {file_id}: {error}")),
            }
        }
        Document { entries, order }
    }
    pub(super) fn get(&self, file_id: i64) -> Option<&Entry> {
        self.entries.get(&file_id)
    }
    /// Les objets d'une classe donnée, dans l'ordre du fichier.
    pub(super) fn of_class(&self, class_id: u32) -> impl Iterator<Item = (i64, &Entry)> {
        self.order.iter().filter_map(move |id| {
            let entry = self.entries.get(id)?;
            (entry.class_id == class_id).then_some((*id, entry))
        })
    }
}

/// Le corps d'un document Unity : la valeur sous son unique clé de type (`GameObject`, `Material`…).
fn single_value(documents: &[Yaml]) -> Option<Yaml> {
    let (_, value) = documents.first()?.as_hash()?.front()?;
    Some(value.clone())
}

/// Les couples (entête, corps) du flux. Tout ce qui précède le premier `---` est une directive.
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

/// `--- !u!1 &100`, `--- !u!1001 &1234 stripped` : classe, fileID, et l'objet n'est qu'une accroche.
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

/// Un nombre, que Unity l'ait écrit entier, flottant ou entre guillemets.
pub(super) fn number(value: &Yaml) -> Option<f64> {
    match value {
        Yaml::Integer(n) => Some(*n as f64),
        Yaml::Real(text) | Yaml::String(text) => text.parse::<f64>().ok(),
        Yaml::Boolean(flag) => Some(f64::from(u8::from(*flag))),
        _ => None,
    }
}
/// Un nombre nommé, ou la valeur par défaut quand la propriété n'est pas écrite.
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
/// `{x, y, z, w}` d'un quaternion Unity, ou `{r, g, b, a}` d'une couleur.
pub(super) fn vec4(value: &Yaml, keys: [&str; 4], default: [f64; 4]) -> [f64; 4] {
    [
        number_at(value, keys[0], default[0]),
        number_at(value, keys[1], default[1]),
        number_at(value, keys[2], default[2]),
        number_at(value, keys[3], default[3]),
    ]
}
/// Le texte d'un scalaire, quelle que soit la façon dont le parseur l'a rangé. Un GUID Unity est
/// une suite de trente-deux chiffres hexadécimaux : `0000000000000000e000000000000000` ressemble à
/// un nombre en notation scientifique et arrive donc en `Real`, dont le texte d'origine est
/// conservé. Le lire par `as_str` seul laisserait la référence sans son GUID.
pub(super) fn text(value: &Yaml) -> Option<String> {
    match value {
        Yaml::String(value) | Yaml::Real(value) => Some(value.clone()),
        Yaml::Integer(value) => Some(value.to_string()),
        _ => None,
    }
}

/// Un entier de soixante-quatre bits, lu comme tel. Le faire passer par un flottant l'abîmerait
/// au-delà de 2^53, et un vrai projet en porte — `33000010677178610` désigne alors un objet qui
/// n'existe pas, et le composant qu'il nomme reste invisible. Unity écrit ses identifiants signés,
/// et quelques-uns au-delà de `i64::MAX` en non signé : les deux nomment le même objet.
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

/// Une référence `{fileID: …, guid: …}`.
pub(super) fn reference(value: &Yaml) -> Ref {
    Ref {
        file_id: integer(&value["fileID"]).unwrap_or(0),
        guid: text(&value["guid"]),
    }
}
/// Les éléments d'une séquence, vide quand la propriété n'est pas une séquence.
pub(super) fn sequence<'a>(value: &'a Yaml, key: &str) -> &'a [Yaml] {
    value[key].as_vec().map_or(&[], Vec::as_slice)
}
/// Unity écrit ses tables de propriétés en séquence de mappages à une seule clé
/// (`- _Metallic: 0.25`). Rend la valeur de la première entrée portant ce nom.
pub(super) fn named<'a>(list: &'a [Yaml], name: &str) -> Option<&'a Yaml> {
    list.iter().find_map(|item| {
        let hash = item.as_hash()?;
        let (key, value) = hash.front()?;
        (key.as_str()? == name).then_some(value)
    })
}
