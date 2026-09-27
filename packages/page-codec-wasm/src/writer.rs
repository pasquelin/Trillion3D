//! The page writer's bit packing, beside the reader's `bits::field`: the compiler and the tests
//! write with it, so a field is laid out by the same code that proves it rereads.

/// Packs fixed-width fields, least significant bit first, into little-endian words. Every
/// stream starts on a word: `close` pads the last one written.
#[derive(Default)]
pub struct BitWriter {
    words: Vec<u32>,
    bit: usize,
}

impl BitWriter {
    pub fn push(&mut self, value: u32, bits: u32) {
        if bits == 0 {
            return;
        }
        let shift = (self.bit % 32) as u32;
        if shift == 0 {
            self.words.push(0);
        }
        let index = self.words.len() - 1;
        self.words[index] |= value << shift;
        if shift + bits > 32 {
            self.words.push(value >> (32 - shift));
        }
        self.bit += bits as usize;
    }

    /// Pads the last word written: the next field starts a new stream.
    pub fn close(&mut self) {
        self.bit = self.words.len() * 32;
    }

    /// One whole stream: its fields, then the padding that closes the last word.
    pub fn stream(&mut self, values: impl Iterator<Item = u32>, bits: u32) {
        for value in values {
            self.push(value, bits);
        }
        self.close();
    }

    pub fn words(&self) -> &[u32] {
        &self.words
    }
}
