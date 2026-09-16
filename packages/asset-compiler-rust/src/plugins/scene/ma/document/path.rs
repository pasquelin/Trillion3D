//! L'identité d'un nœud de la scène : son chemin, et le nœud qu'un nom écrit désigne.
//!
//! Maya nomme ses nœuds par leur chemin complet — `|A|M` — et n'exige l'unicité du nom court que
//! sous un même père : deux `transform` nommés `M`, l'un sous `A` et l'autre sous `B`, sont deux
//! nœuds. Un fichier les désigne par le nom court tant qu'il n'y en a qu'un, et par le chemin dès
//! qu'il y en a deux ; les confondre ferait que le second écrase le premier.
use super::*;

/// Le chemin complet d'un nœud de ce nom sous ce père, tel que Maya l'écrit.
pub(super) fn under(document: &Document, parent: Option<usize>, name: &str) -> String {
    let head = parent.map_or("", |parent| document.nodes[parent].path.as_str());
    format!("{head}|{}", leaf(name))
}

impl Document {
    /// Le nœud qu'un nom écrit désigne, et s'il en désignait plusieurs. Un nom qui porte un `|` est
    /// un chemin : seuls les nœuds dont le chemin se termine par lui répondent. Un nom court retient
    /// tous ses homonymes, et c'est alors le premier écrit qui répond.
    fn named(&self, written: &str) -> (Option<usize>, bool) {
        let ranks = self
            .by_name
            .get(leaf(written))
            .map_or(&[][..], Vec::as_slice);
        let tail = format!("|{}", written.trim_start_matches('|'));
        let mut found = ranks
            .iter()
            .filter(|rank| !written.contains('|') || self.nodes[**rank].path.ends_with(&tail));
        let first = found.next().copied();
        (first, found.next().is_some())
    }

    /// Le nœud qu'un nom écrit désigne, l'ambiguïté comptée quand plusieurs y répondent : le
    /// fichier aurait dû écrire un chemin, et prendre l'un des deux au hasard changerait la scène.
    pub(in super::super) fn find(&mut self, written: &str) -> Option<usize> {
        let (found, ambiguous) = self.named(written);
        if ambiguous {
            self.report.add(report::NAME_AMBIGUOUS);
        }
        found
    }

    /// Range un nœud neuf sous son nom court : ses homonymes se suivent dans l'ordre du fichier.
    pub(super) fn remember(&mut self, name: &str, rank: usize) {
        self.by_name
            .entry(leaf(name).to_string())
            .or_default()
            .push(rank);
    }
}
