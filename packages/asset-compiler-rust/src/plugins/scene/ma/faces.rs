//! Les faces d'un maillage, telles que `.fc` et les listes de composants les écrivent.
//!
//! Une face Maya ne cite pas ses sommets : elle cite ses **arêtes**, signées. Un indice positif `i`
//! parcourt l'arête `i` de son premier vers son second sommet ; l'écriture `-(i + 1)` la parcourt à
//! l'envers. Le coin de rang `k` d'une face est donc le sommet de départ de sa `k`-ième arête, et
//! c'est `.ed` qui les nomme. Un enregistrement `mu` donne, dans le même ordre, les rangs d'UV de
//! ces coins ; `h` ouvre un trou, `mf` et `mc` portent des normales et des couleurs par coin que ce
//! pilote ne lit pas. Tout enregistrement hors de cette liste est compté par son nom.
use super::*;

/// Une face polygonale : ses arêtes signées, et les rangs d'UV de ses coins.
#[derive(Clone, Default)]
pub(super) struct Face {
    pub(super) edges: Vec<i64>,
    pub(super) uvs: Vec<i64>,
    /// Le jeu d'UV que `mu` désigne. Seul le premier est porté par la scène intermédiaire.
    pub(super) uv_set: i64,
    /// La face déclare un trou : un éventail depuis son premier coin le remplirait.
    pub(super) hole: bool,
}

/// Les faces qu'un `setAttr -type "polyFaces"` écrit, et ce que le rapport doit en compter.
pub(super) fn polygons(operands: &[Token]) -> (Vec<Face>, Vec<&'static str>) {
    let mut out: Vec<Face> = Vec::new();
    let mut counted = Vec::new();
    let mut words = operands.iter().map(Token::text).peekable();
    while let Some(record) = words.next() {
        match record {
            "f" => out.push(Face {
                edges: indices(&mut words),
                ..Face::default()
            }),
            "mu" => {
                let set = words.next().and_then(|word| word.parse::<i64>().ok());
                let uvs = indices(&mut words);
                match (out.last_mut(), set) {
                    (Some(face), Some(set)) => {
                        face.uv_set = set;
                        face.uvs = uvs;
                    }
                    _ => counted.push(report::UV_DROPPED),
                }
            }
            "h" => {
                let _ = indices(&mut words);
                match out.last_mut() {
                    Some(face) => face.hole = true,
                    None => counted.push(report::FACE_INVALID),
                }
            }
            "mf" | "mc" | "fc" => {
                let _ = indices(&mut words);
            }
            _ => counted.push(report::FACE_RECORD_IGNORED),
        }
    }
    (out, counted)
}

/// Les indices d'un enregistrement : un compte, puis autant d'entiers. Un compte absent ou absurde
/// ne consomme rien, ce qui arrête la lecture de l'enregistrement au lieu de la faire dériver.
fn indices<'a>(words: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>) -> Vec<i64> {
    let Some(count) = words.peek().and_then(|word| word.parse::<usize>().ok()) else {
        return Vec::new();
    };
    words.next();
    let mut out = Vec::with_capacity(count.min(MAX_ELEMENTS));
    for _ in 0..count.min(MAX_ELEMENTS) {
        match words.peek().and_then(|word| word.parse::<i64>().ok()) {
            Some(value) => {
                words.next();
                out.push(value);
            }
            None => break,
        }
    }
    out
}

/// Les faces qu'une liste de composants désigne, et le nombre d'entrées qui n'en désignent aucune.
/// Maya écrit `f[3]` pour une face et `f[0:2]` pour un intervalle ; un sommet ou une arête — `vtx`,
/// `e`, `map` — ne dit rien d'une face et est compté plutôt que deviné.
pub(super) fn components(list: &[String]) -> (Vec<usize>, usize) {
    let mut out = Vec::new();
    let mut refused = 0;
    for entry in list {
        let Some(range) = entry
            .strip_prefix("f[")
            .and_then(|rest| rest.strip_suffix(']'))
        else {
            refused += 1;
            continue;
        };
        match span(range) {
            Some((first, count)) => out.extend(first..first.saturating_add(count)),
            None => refused += 1,
        }
    }
    (out, refused)
}

/// Le premier élément d'un intervalle `a:b` ou d'un indice seul `a`, et le nombre d'éléments.
pub(super) fn span(range: &str) -> Option<(usize, usize)> {
    let (first, last) = match range.split_once(':') {
        Some((first, last)) => (
            first.trim().parse::<usize>().ok()?,
            last.trim().parse::<usize>().ok()?,
        ),
        None => {
            let only = range.trim().parse::<usize>().ok()?;
            (only, only)
        }
    };
    (last >= first && last < MAX_ELEMENTS).then(|| (first, last - first + 1))
}
