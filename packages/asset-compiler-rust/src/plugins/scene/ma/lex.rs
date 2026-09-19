//! Splitting a Maya ASCII file into commands, without executing any.
//!
//! A `.ma` is text of commands separated by `;`. This module knows only the form — `//` and
//! `/* */` comments, quoted strings with escapes, bare words — and yields a sequence of tokens
//! per command. It does not know what a command means and evaluates nothing: no backtick
//! substitution, no expression, no script. A never-closed string is a named refusal, not a read
//! that swallows the rest of the file as if it were part of it.
use super::*;

/// A command token: a bare word, or a literal string already unescaped. The distinction
/// matters: a bare `-n` is a flag, `"-n"` in quotes is a value.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum Token {
    Word(String),
    Text(String),
}

impl Token {
    /// Text of the token, whatever its writing.
    pub(super) fn text(&self) -> &str {
        match self {
            Self::Word(word) | Self::Text(word) => word,
        }
    }
    /// Name of the flag this token carries: a bare dash followed by a letter. A negative number
    /// is not one, and a literal string is not one either.
    pub(super) fn flag(&self) -> Option<&str> {
        let Self::Word(word) = self else {
            return None;
        };
        let name = word.strip_prefix('-')?;
        name.starts_with(|first: char| first.is_ascii_alphabetic())
            .then_some(name)
    }
}

/// A command as read: its name and its tokens, as they are written.
pub(super) struct Statement {
    pub(super) name: String,
    pub(super) tokens: Vec<Token>,
}

/// Commands of a text, read on demand: the document fills as reading proceeds, and nothing
/// keeps every token of a file in memory.
pub(super) struct Reader<'a> {
    rest: &'a str,
}

/// Command reader of Maya ASCII text.
pub(super) fn read(text: &str) -> Reader<'_> {
    Reader { rest: text }
}

impl Iterator for Reader<'_> {
    type Item = Result<Statement>;
    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let tokens = match self.tokens() {
                Ok(tokens) if tokens.is_empty() && self.rest.is_empty() => return None,
                Ok(tokens) => tokens,
                Err(error) => {
                    self.rest = "";
                    return Some(Err(error));
                }
            };
            let Some((head, rest)) = tokens.split_first() else {
                continue;
            };
            return Some(Ok(Statement {
                name: head.text().to_string(),
                tokens: rest.to_vec(),
            }));
        }
    }
}

impl Reader<'_> {
    /// Tokens of the next command, up to the `;` that ends it or to the end of the text. A file
    /// whose last command is unfinished still yields its tokens: that is incomplete writing, not
    /// a reason to forget what precedes.
    fn tokens(&mut self) -> Result<Vec<Token>> {
        let mut out = Vec::new();
        loop {
            self.skip();
            let Some(head) = self.rest.chars().next() else {
                return Ok(out);
            };
            if head == ';' {
                self.rest = &self.rest[1..];
                return Ok(out);
            }
            out.push(match head {
                '"' => Token::Text(self.string()?),
                _ => Token::Word(self.word()),
            });
        }
    }

    /// Whitespace and comments: `//` to the end of the line, `/* */` until its close.
    fn skip(&mut self) {
        loop {
            self.rest = self.rest.trim_start();
            if let Some(rest) = self.rest.strip_prefix("//") {
                self.rest = rest.split_once('\n').map_or("", |(_, after)| after);
                continue;
            }
            if let Some(rest) = self.rest.strip_prefix("/*") {
                self.rest = rest.split_once("*/").map_or("", |(_, after)| after);
                continue;
            }
            return;
        }
    }

    /// A literal string, unescaped.
    fn string(&mut self) -> Result<String> {
        let mut out = String::new();
        let mut escaped = false;
        for (at, letter) in self.rest.char_indices().skip(1) {
            if escaped {
                out.push(match letter {
                    'n' => '\n',
                    't' => '\t',
                    other => other,
                });
                escaped = false;
                continue;
            }
            match letter {
                '\\' => escaped = true,
                '"' => {
                    self.rest = &self.rest[at + 1..];
                    return Ok(out);
                }
                other => out.push(other),
            }
        }
        self.rest = "";
        Err(CompilerError::new(
            FILE_INVALID,
            "ma: a quoted string is never closed; the file stops inside a name",
        ))
    }

    /// A bare word: anything that is neither whitespace, nor `;`, nor a quote.
    fn word(&mut self) -> String {
        let end = self
            .rest
            .find(|letter: char| letter.is_whitespace() || letter == ';' || letter == '"')
            .unwrap_or(self.rest.len());
        let (word, rest) = self.rest.split_at(end);
        self.rest = rest;
        word.to_string()
    }
}
