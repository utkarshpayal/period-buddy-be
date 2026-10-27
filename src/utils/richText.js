/**
 * Rich content written in the admin editor (period-buddy-content,
 * src/lib/richText.ts): Markdown plus an allowlist of inline HTML
 * (<span data-color>, <mark data-color>, <u>) and ```chart blocks holding
 * chart JSON. The website and app render it; these helpers keep the markup
 * out of places that want words: reading time, translation, search scoring.
 */

export const CHART_FENCE = /```chart[^\n]*\n[\s\S]*?```/g;

/** The inline styling tags the editor writes. Translation drops them. */
const STYLE_TAGS = /<\/?(?:span|mark|u)(?:\s+data-color="[a-z]+")?\s*>/g;

/** Readable text: no chart data, HTML tags, image or link targets, or Markdown markers. */
export const richTextToPlain = (content = '') =>
  String(content ?? '')
    .replace(CHART_FENCE, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

const IMAGE_LINE = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;

/**
 * Splits content into the parts a translator should see and the parts it
 * must leave alone (chart blocks and image-only paragraphs), in order:
 * `[{ text, translate }]`. Styling tags are removed from translatable parts,
 * so a translation keeps Markdown formatting but loses colors.
 */
export const splitForTranslation = (content = '') => {
  const parts = [];
  const pushText = (text) => {
    text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((paragraph) => {
        if (IMAGE_LINE.test(paragraph)) parts.push({ text: paragraph, translate: false });
        else {
          const last = parts[parts.length - 1];
          const clean = paragraph.replace(STYLE_TAGS, '');
          if (last?.translate) last.text += `\n\n${clean}`;
          else parts.push({ text: clean, translate: true });
        }
      });
  };

  let cursor = 0;
  for (const match of String(content ?? '').matchAll(CHART_FENCE)) {
    pushText(content.slice(cursor, match.index));
    parts.push({ text: match[0], translate: false });
    cursor = match.index + match[0].length;
  }
  pushText(String(content ?? '').slice(cursor));
  return parts;
};
