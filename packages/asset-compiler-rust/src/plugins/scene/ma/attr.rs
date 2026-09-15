//! Ce qu'un `setAttr` écrit : quel nœud, quel attribut, à quel rang, et sous quelle forme.
//!
//! Le premier opérande nomme l'attribut — `".t"` sur le nœud courant, `"Nœud.t"` sur un nœud
//! nommé, `".uvst[0].uvsp[0:3]"` sur une tranche d'un tableau imbriqué. L'intervalle du dernier
//! segment dit **où** écrire, et le `-type` sous quelle forme. Sans type, ce sont des nombres ou un
//! booléen. Un type hors de cette liste est compté : le pilote ne devine pas une forme.
use super::*;

/// Le chemin d'un attribut tel que `setAttr` l'écrit.
pub(super) struct Path {
    /// Le nœud nommé devant le point, quand la commande en nomme un.
    pub(super) node: Option<String>,
    /// La clé de l'attribut : ses segments joints par un point, les indices des segments
    /// intermédiaires conservés, celui du dernier retiré — il dit où écrire, pas quoi.
    pub(super) key: String,
    /// Le premier élément visé, et leur nombre quand l'intervalle en donne un.
    pub(super) first: usize,
    pub(super) count: Option<usize>,
}

/// Découpe le chemin d'un attribut. Un chemin sans segment d'attribut n'en est pas un.
pub(super) fn path(written: &str) -> Option<Path> {
    let mut segments = written.split('.');
    let head = segments.next()?;
    let node = (!head.is_empty()).then(|| head.to_string());
    let mut segments: Vec<&str> = segments.collect();
    let last = segments.pop()?;
    let (name, span) = match last.split_once('[') {
        Some((name, range)) => (name, faces::span(range.trim_end_matches(']'))),
        None => (last, None),
    };
    segments.push(name);
    Some(Path {
        node,
        key: segments.join("."),
        first: span.map_or(0, |(first, _)| first),
        count: span.map(|(_, count)| count),
    })
}

/// Le nombre de nombres que porte un élément de ce type, quand le type le fixe.
fn stride(kind: &str) -> Option<usize> {
    Some(match kind {
        "float3" | "double3" | "short3" | "long3" | "int3" => 3,
        "float2" | "double2" | "short2" | "long2" | "int2" => 2,
        "matrix" => 16,
        _ => return None,
    })
}

/// La valeur qu'une commande `setAttr` écrit, et le nombre de nombres par élément. Rien quand le
/// type demandé est hors de ceux que ce pilote lit.
pub(super) fn value(command: &Command, refused: &mut Vec<&'static str>) -> Option<(Attr, usize)> {
    let kind = command.text(&["typ", "type"]);
    let operands = command.operands.get(1..).unwrap_or_default();
    match kind {
        Some("string") => Some((
            Attr::Texts(
                operands
                    .iter()
                    .map(|token| token.text().to_string())
                    .collect(),
            ),
            1,
        )),
        Some("stringArray" | "componentList") => Some((
            Attr::Texts(
                operands
                    .iter()
                    .skip(1)
                    .map(|token| token.text().to_string())
                    .collect(),
            ),
            1,
        )),
        Some("polyFaces") => {
            let (polygons, counted) = faces::polygons(operands);
            refused.extend(counted);
            Some((Attr::Faces(polygons), 1))
        }
        Some("Int32Array" | "doubleArray" | "floatArray") => {
            Some((numbers(&operands[1.min(operands.len())..]), 1))
        }
        Some(named) => stride(named).map(|stride| (numbers(operands), stride)),
        None => plain(operands),
    }
}

/// Une valeur sans type déclaré : un booléen écrit en mots, sinon des nombres.
fn plain(operands: &[Token]) -> Option<(Attr, usize)> {
    if let [only] = operands {
        let word = only.text();
        if command::number(word).is_none() {
            return command::boolean(word).map(|flag| (Attr::Flag(flag), 1));
        }
    }
    Some((numbers(operands), 1))
}

/// Les nombres d'une suite d'opérandes. Un opérande qui n'est pas un nombre ne contribue pas : un
/// tableau tronqué est plus court, il n'invente pas de valeur.
fn numbers(operands: &[Token]) -> Attr {
    Attr::Numbers(
        operands
            .iter()
            .filter_map(|token| command::number(token.text()))
            .collect(),
    )
}

/// Le rang du premier nombre visé, et la forme à verser. La foulée vient du type quand il la fixe,
/// sinon du nombre de valeurs écrites par élément de l'intervalle.
pub(super) fn slice(path: &Path, value: Attr, stride: usize) -> Option<(usize, Attr)> {
    let width = match (&value, path.count) {
        (Attr::Numbers(values), Some(count)) if stride == 1 && count > 0 => {
            (values.len() % count == 0).then_some(values.len() / count)?
        }
        _ => stride,
    };
    Some((path.first.checked_mul(width)?, value))
}
