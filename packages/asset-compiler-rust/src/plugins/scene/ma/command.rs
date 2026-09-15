//! Une commande séparée en drapeaux et en opérandes, selon ce que chaque drapeau consomme.
//!
//! La syntaxe de MEL ne dit pas combien de valeurs un drapeau prend : c'est la commande qui le
//! sait. Ce module porte donc la table des drapeaux **à valeur** des seules commandes du
//! sous-ensemble lu. Tout autre drapeau y est un interrupteur, ce qui ne consomme rien : une
//! commande hors sous-ensemble n'est jamais séparée ainsi, elle est comptée par son nom et laissée.
use super::*;

/// Une commande du sous-ensemble, prête à lire : ses drapeaux d'un côté, ses opérandes de l'autre.
pub(super) struct Command {
    pub(super) name: String,
    flags: Vec<(String, Option<Token>)>,
    pub(super) operands: Vec<Token>,
}

/// Les drapeaux à valeur de chaque commande du sous-ensemble, noms courts et longs, tels que la
/// documentation des commandes les décrit. Ce qui n'y est pas ne consomme pas d'opérande.
fn valued(command: &str) -> &'static [&'static str] {
    match command {
        "createNode" => &["n", "name", "p", "parent", "uid"],
        "setAttr" => &[
            "s",
            "size",
            "typ",
            "type",
            "k",
            "keyable",
            "l",
            "lock",
            "cb",
            "channelBox",
            "ca",
            "caching",
        ],
        "connectAttr" => &["l", "lock"],
        "currentUnit" => &["l", "linear", "a", "angle", "t", "time"],
        _ => &[],
    }
}

impl Command {
    /// Sépare les drapeaux des opérandes d'une commande déjà découpée en jetons.
    pub(super) fn new(statement: lex::Statement) -> Self {
        let table = valued(&statement.name);
        let mut flags: Vec<(String, Option<Token>)> = Vec::new();
        let mut operands = Vec::new();
        let mut tokens = statement.tokens.into_iter();
        while let Some(token) = tokens.next() {
            match token.flag() {
                Some(name) => {
                    let name = name.to_string();
                    let value = table
                        .contains(&name.as_str())
                        .then(|| tokens.next())
                        .flatten();
                    flags.push((name, value));
                }
                None => operands.push(token),
            }
        }
        Self {
            name: statement.name,
            flags,
            operands,
        }
    }

    /// La valeur du premier drapeau dont le nom est dans `names` : `-n` et `-name` s'y donnent
    /// ensemble, puisque MEL accepte l'un pour l'autre.
    pub(super) fn flag(&self, names: &[&str]) -> Option<&Token> {
        self.flags
            .iter()
            .find(|(name, _)| names.contains(&name.as_str()))?
            .1
            .as_ref()
    }

    /// Le texte de ce drapeau.
    pub(super) fn text(&self, names: &[&str]) -> Option<&str> {
        self.flag(names).map(Token::text)
    }

    /// Ce drapeau est-il écrit, à valeur ou en interrupteur ?
    pub(super) fn switch(&self, names: &[&str]) -> bool {
        self.flags
            .iter()
            .any(|(name, _)| names.contains(&name.as_str()))
    }

    /// Le texte de l'opérande de rang `at`.
    pub(super) fn operand(&self, at: usize) -> Option<&str> {
        self.operands.get(at).map(Token::text)
    }
}

/// Le nombre qu'un mot écrit, ou rien quand ce mot n'en est pas un.
pub(super) fn number(word: &str) -> Option<f64> {
    word.parse::<f64>().ok().filter(|value| value.is_finite())
}

/// Le booléen qu'un mot écrit. MEL les écrit de six façons, et un nombre non nul en est un aussi.
pub(super) fn boolean(word: &str) -> Option<bool> {
    match word {
        "yes" | "on" | "true" | "1" => Some(true),
        "no" | "off" | "false" | "0" => Some(false),
        other => number(other).map(|value| value != 0.0),
    }
}
