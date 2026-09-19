//! A command split into flags and operands, according to what each flag consumes.
//!
//! MEL syntax does not say how many values a flag takes: the command knows. This module therefore
//! carries the table of **valued** flags of the subset of commands that is read. Any other flag is
//! a switch, which consumes nothing: a command outside the subset is never split this way; it is
//! counted by name and left.
use super::*;

/// A subset command, ready to read: its flags on one side, its operands on the other.
pub(super) struct Command {
    pub(super) name: String,
    flags: Vec<(String, Option<Token>)>,
    pub(super) operands: Vec<Token>,
}

/// Valued flags of each subset command, short and long names, as the command documentation
/// describes them. What is not in there consumes no operand.
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
    /// Splits flags from operands of a command already tokenized.
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

    /// Value of the first flag whose name is in `names`: `-n` and `-name` are given together,
    /// since MEL accepts one for the other.
    pub(super) fn flag(&self, names: &[&str]) -> Option<&Token> {
        self.flags
            .iter()
            .find(|(name, _)| names.contains(&name.as_str()))?
            .1
            .as_ref()
    }

    /// Text of this flag.
    pub(super) fn text(&self, names: &[&str]) -> Option<&str> {
        self.flag(names).map(Token::text)
    }

    /// Is this flag written, valued or as a switch?
    pub(super) fn switch(&self, names: &[&str]) -> bool {
        self.flags
            .iter()
            .any(|(name, _)| names.contains(&name.as_str()))
    }

    /// Text of the operand at rank `at`.
    pub(super) fn operand(&self, at: usize) -> Option<&str> {
        self.operands.get(at).map(Token::text)
    }
}

/// Number a word writes, or nothing when that word is not one.
pub(super) fn number(word: &str) -> Option<f64> {
    word.parse::<f64>().ok().filter(|value| value.is_finite())
}

/// Boolean a word writes. MEL writes them six ways, and a non-zero number is one too.
pub(super) fn boolean(word: &str) -> Option<bool> {
    match word {
        "yes" | "on" | "true" | "1" => Some(true),
        "no" | "off" | "false" | "0" => Some(false),
        other => number(other).map(|value| value != 0.0),
    }
}
