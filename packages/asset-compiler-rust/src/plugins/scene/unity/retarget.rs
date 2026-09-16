//! Décaler les renvois de table d'un document glTF versé dans un autre.
//!
//! Un modèle rend un glTF complet, et ses tables se désignent entre elles par des rangs qui n'ont
//! de sens que chez lui. Le verser dans la scène, c'est recopier ces tables à la suite de celles de
//! la scène, donc décaler **tous** ces rangs — pas seulement ceux qu'on avait sous les yeux. Un
//! renvoi oublié ne devient pas vide : il désigne la ligne d'un autre modèle, et la scène lit alors
//! des octets qui ne sont pas les siens. La règle de décalage vit ici, et nulle part ailleurs.
use super::*;

/// Où un rang de table se lit dans un sous-arbre du document.
pub(super) enum Slot<'a> {
    /// La valeur de cette clé exacte, à quelque profondeur qu'elle se trouve : c'est ce qui fait
    /// suivre les deux vues d'un accesseur creux avec sa vue directe.
    Key(&'a str),
    /// Le champ `index` de toute clé finissant par ce suffixe : c'est ainsi qu'un matériau désigne
    /// ses textures, `baseColorTexture` comme `normalTexture`.
    Suffix(&'a str),
    /// Toutes les valeurs de l'objet porté par cette clé, ou de chaque objet de ce tableau : les
    /// noms d'attributs — `POSITION`, `TEXCOORD_0` — appartiennent au document, pas au format.
    Members(&'a str),
}

/// Où lire un rang, et la table de la scène vers laquelle il doit pointer.
pub(super) struct Rule<'a> {
    pub(super) slot: Slot<'a>,
    pub(super) map: &'a [usize],
}

impl<'a> Rule<'a> {
    pub(super) fn key(name: &'a str, map: &'a [usize]) -> Rule<'a> {
        Rule {
            slot: Slot::Key(name),
            map,
        }
    }
    pub(super) fn suffix(name: &'a str, map: &'a [usize]) -> Rule<'a> {
        Rule {
            slot: Slot::Suffix(name),
            map,
        }
    }
    pub(super) fn members(name: &'a str, map: &'a [usize]) -> Rule<'a> {
        Rule {
            slot: Slot::Members(name),
            map,
        }
    }
}

/// Décale, dans tout le sous-arbre, chaque rang que ces règles désignent.
pub(super) fn retarget(value: &mut Value, rules: &[Rule<'_>]) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(|item| retarget(item, rules)),
        Value::Object(fields) => {
            let names: Vec<String> = fields.keys().cloned().collect();
            for rule in rules {
                for name in &names {
                    apply(fields, name, rule);
                }
            }
            fields.values_mut().for_each(|item| retarget(item, rules));
        }
        _ => {}
    }
}

/// Une règle sur un champ de cet objet.
fn apply(fields: &mut serde_json::Map<String, Value>, name: &str, rule: &Rule<'_>) {
    match rule.slot {
        Slot::Key(key) if key == name => shift(fields, name, rule.map),
        Slot::Suffix(suffix) if name.ends_with(suffix) => {
            if let Some(info) = fields.get_mut(name).and_then(Value::as_object_mut) {
                shift(info, "index", rule.map);
            }
        }
        Slot::Members(key) if key == name => {
            if let Some(item) = fields.get_mut(name) {
                members(item, rule.map);
            }
        }
        _ => {}
    }
}

/// Décale le rang porté par cette clé. Une clé absente ne fait rien ; un rang que la table du
/// modèle ne porte pas ne désigne rien dans la scène, et sa clé est retirée plutôt que laissée à
/// pointer sur la ligne d'un voisin.
fn shift(fields: &mut serde_json::Map<String, Value>, key: &str, map: &[usize]) {
    let Some(item) = fields.get(key) else {
        return;
    };
    match index(item, map) {
        Some(rank) => {
            fields.insert(key.to_string(), json!(rank));
        }
        None => {
            fields.remove(key);
        }
    }
}

/// Les rangs que porte un objet dont les noms de champs appartiennent au document, ou chacun des
/// objets d'un tableau — un jeu d'attributs, une liste de cibles de morphing.
fn members(value: &mut Value, map: &[usize]) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(|item| members(item, map)),
        Value::Object(fields) => {
            for name in fields.keys().cloned().collect::<Vec<String>>() {
                shift(fields, &name, map);
            }
        }
        _ => {}
    }
}
