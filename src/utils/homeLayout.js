/**
 * Each person's own Home layout (app: Profile → Customize Home).
 *
 * The app owns the meaning of the keys: `order` / `hidden` hold Home block
 * ids (statPills, insights, ...) and `shortcuts` holds feature keys or
 * `link:<id>` tile keys. So this only checks their shape, not that each key
 * exists: an app that knows a newer block can save it, and an old key the
 * app no longer knows is simply ignored there.
 */

const KEY_PATTERN = /^[A-Za-z0-9_:-]{1,64}$/;
export const MAX_LAYOUT_KEYS = 40;
export const MAX_SHORTCUTS = 12;
export const SHORTCUT_LOOKS = ['icon', 'tile', 'card'];
const COLOR_PATTERN = /^[a-z]{1,20}$/;
const ICON_PATTERN = /^[a-z0-9-]{1,40}$/;
export const LABEL_MAX = 24;
export const TITLE_MAX = 30;
const MAX_BLOCKS = 20;

/** One line of the person's own text (a renamed shortcut or heading), or `{ error }`. */
const text = (value, field, max) => {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== 'string') return { error: `${field} must be text` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return { error: `${field} must be one line` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${field} can be at most ${max} characters` };
  return { value: trimmed || null };
};

/** { [tileKey]: { look, color } } → cleaned copy, or `{ error }`. Colour null = the tile's own. */
const parseStyles = (value) => {
  if (value === undefined || value === null) return { styles: {} };
  if (typeof value !== 'object' || Array.isArray(value))
    return { error: 'shortcutStyles must be an object' };
  const entries = Object.entries(value);
  if (entries.length > MAX_SHORTCUTS)
    return { error: `shortcutStyles can have at most ${MAX_SHORTCUTS} items` };
  const styles = {};
  for (const [key, style] of entries) {
    if (!KEY_PATTERN.test(key) || !style || typeof style !== 'object')
      return { error: 'shortcutStyles has an invalid entry' };
    if (!SHORTCUT_LOOKS.includes(style.look))
      return { error: `look must be one of ${SHORTCUT_LOOKS.join(', ')}` };
    const color = style.color ?? null;
    if (color !== null && (typeof color !== 'string' || !COLOR_PATTERN.test(color)))
      return { error: 'color is invalid' };
    const icon = style.icon ?? null;
    if (icon !== null && (typeof icon !== 'string' || !ICON_PATTERN.test(icon)))
      return { error: 'icon is invalid' };
    const label = text(style.label, 'label', LABEL_MAX);
    if (label.error) return label;
    styles[key] = { look: style.look, color, label: label.value, icon };
  }
  return { styles };
};

/** { [blockKey]: { title, items } } → cleaned copy, or `{ error }`. */
const parseBlocks = (value) => {
  if (value === undefined || value === null) return { blocks: {} };
  if (typeof value !== 'object' || Array.isArray(value))
    return { error: 'blocks must be an object' };
  const entries = Object.entries(value);
  if (entries.length > MAX_BLOCKS) return { error: `blocks can have at most ${MAX_BLOCKS} items` };
  const blocks = {};
  for (const [key, opts] of entries) {
    if (!KEY_PATTERN.test(key) || !opts || typeof opts !== 'object' || Array.isArray(opts))
      return { error: 'blocks has an invalid entry' };
    const title = text(opts.title, 'title', TITLE_MAX);
    if (title.error) return title;
    let items = null;
    if (opts.items !== undefined && opts.items !== null) {
      const parsed = keyList(opts.items, 'items', MAX_SHORTCUTS);
      if (parsed.error) return parsed;
      items = parsed.keys;
    }
    blocks[key] = { title: title.value, items };
  }
  return { blocks };
};

const keyList = (value, field, max) => {
  if (!Array.isArray(value)) return { error: `${field} must be a list` };
  const keys = [];
  for (const v of value) {
    if (typeof v !== 'string' || !KEY_PATTERN.test(v))
      return { error: `${field} has an invalid key` };
    if (!keys.includes(v)) keys.push(v);
  }
  if (keys.length > max) return { error: `${field} can have at most ${max} items` };
  return { keys };
};

/**
 * Body of PUT /api/auth/home-layout → `{ layout }` or `{ error }`. The whole
 * layout is replaced (`shortcutStyles` and `blocks` are optional, see
 * parseStyles / parseBlocks). `shortcuts: null` (or left out) means "the app's
 * default shortcuts", which is different from `[]` (no shortcuts at all).
 */
export const parseHomeLayout = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return { error: 'Send a layout object' };
  const order = keyList(body.order ?? [], 'order', MAX_LAYOUT_KEYS);
  if (order.error) return order;
  const hidden = keyList(body.hidden ?? [], 'hidden', MAX_LAYOUT_KEYS);
  if (hidden.error) return hidden;
  let shortcuts = null;
  if (body.shortcuts !== undefined && body.shortcuts !== null) {
    const parsed = keyList(body.shortcuts, 'shortcuts', MAX_SHORTCUTS);
    if (parsed.error) return parsed;
    shortcuts = parsed.keys;
  }
  const { styles, error } = parseStyles(body.shortcutStyles);
  if (error) return { error };
  const parsedBlocks = parseBlocks(body.blocks);
  if (parsedBlocks.error) return parsedBlocks;
  return {
    layout: {
      order: order.keys,
      hidden: hidden.keys,
      shortcuts,
      shortcutStyles: styles,
      blocks: parsedBlocks.blocks,
    },
  };
};

/** What the app gets back: the saved layout, or the empty default. */
export const describeHomeLayout = (user) => {
  const saved = user?.homeLayout;
  return {
    order: saved?.order ?? [],
    hidden: saved?.hidden ?? [],
    shortcuts: Array.isArray(saved?.shortcuts) ? saved.shortcuts : null,
    shortcutStyles:
      saved?.shortcutStyles && typeof saved.shortcutStyles === 'object' ? saved.shortcutStyles : {},
    blocks: saved?.blocks && typeof saved.blocks === 'object' ? saved.blocks : {},
    updatedAt: saved?.updatedAt ?? null,
  };
};
