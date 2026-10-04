const segments = new Intl.Segmenter('en', { granularity: 'grapheme' });
const emoji = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Presentation}|\u20e3/u;

/** Remove whole emoji sequences from image labels without changing saved names. */
export function cleanGraphicName(value) {
    const text = String(value ?? '').replace(/<a?:[A-Za-z0-9_]+:\d+>/g, '');
    return Array.from(segments.segment(text), ({ segment }) => segment)
        .filter(segment => !emoji.test(segment))
        .join('')
        .replace(/[\u200d\ufe0e\ufe0f\u{E0020}-\u{E007F}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}
