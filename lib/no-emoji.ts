/**
 * Strip emoji / pictographs from user-entered text.
 * Staff and students must not store emojis in free-text fields.
 */

/** Extended pictographic + variation selectors + ZWJ sequences leftovers. */
const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u20E3]/gu

/** Common emoji-like symbols sometimes missed by Extended_Pictographic alone. */
const EXTRA_SYMBOL_RE =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu

export function stripEmoji(input: string | null | undefined): string {
  if (input == null) return ""
  return String(input)
    .replace(EMOJI_RE, "")
    .replace(EXTRA_SYMBOL_RE, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Strip emoji but keep internal spacing (for multi-line notes). */
export function stripEmojiPreserveNewlines(input: string | null | undefined): string {
  if (input == null) return ""
  return String(input)
    .replace(EMOJI_RE, "")
    .replace(EXTRA_SYMBOL_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
}

export function containsEmoji(input: string | null | undefined): boolean {
  if (input == null || input === "") return false
  return EMOJI_RE.test(String(input)) || EXTRA_SYMBOL_RE.test(String(input))
}
