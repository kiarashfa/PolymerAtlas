// Automatic cross-linking (instructions.md §9.3): a build-time rehype plugin
// that links polymer/concept mentions in narrative prose using the
// name + abbreviation[] + aliases[] dictionary from the data files.
// Guardrails (all locked):
//   • at most one link per target entry per page (its first occurrence)
//   • never inside headings, existing links, or code
//   • never the page's own entry
//   • word-boundary matching; all-caps terms match case-sensitively
//     (PE, PVC…), everything else case-insensitively (starch, nylon…)
//   • aliases flagged autolinkable:false are excluded (ambiguity guard);
//     a term claimed by two different entries is dropped entirely
// No manual internal links exist in content — this plugin is the only
// source of narrative cross-links.
import { readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { bareName, splitTitle } from './titles';
import { contentIds, frontmatter } from './scan';

interface Target {
  id: string;
  path: string;
}

interface Dictionary {
  /** case-sensitive terms (all-caps abbreviations), keyed exactly */
  exact: Map<string, Target>;
  /** case-insensitive terms, keyed by lowercase */
  loose: Map<string, Target>;
  exactRe: RegExp | null;
  looseRe: RegExp | null;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** All-caps abbreviations additionally refuse hyphen neighbours — "CN" in
 *  the formula fragment "CH=CH-CN" is not a nitrocellulose mention. */
const boundaryRe = (terms: string[], flags: string, boundary: string) =>
  terms.length
    ? new RegExp(
        `(?<![${boundary}])(?:${terms
          .sort((a, b) => b.length - a.length)
          .map(escapeRe)
          .join('|')})(?![${boundary}])`,
        flags
      )
    : null;

/** Chemical-formula text (subscript digits, reaction arrows) never gets
 *  autolinks — abbreviation lookalikes inside formulas are not mentions. */
const FORMULA_RE = /[₀₁₂₃₄₅₆₇₈₉→⇌]/;

function buildDictionary(root: string, base: string): Dictionary {
  const exact = new Map<string, Target>();
  const loose = new Map<string, Target>();
  const ambiguous = new Set<string>();

  const claim = (term: string, target: Target) => {
    const t = term.trim();
    if (t.length < 2) return;
    const caseSensitive = !/[a-z]/.test(t);
    const map = caseSensitive ? exact : loose;
    const key = caseSensitive ? t : t.toLowerCase();
    const existing = map.get(key);
    if (existing && existing.id !== target.id) {
      ambiguous.add(`${caseSensitive ? 'exact' : 'loose'}:${key}`);
      map.delete(key);
      console.warn(
        `[autolink] term "${t}" claimed by both "${existing.id}" and "${target.id}" — dropped as ambiguous`
      );
      return;
    }
    if (!ambiguous.has(`${caseSensitive ? 'exact' : 'loose'}:${key}`)) map.set(key, target);
  };

  for (const id of contentIds(join(root, 'src/content/polymerData'), '.json')) {
    const data = JSON.parse(
      readFileSync(join(root, 'src/content/polymerData', `${id}.json`), 'utf-8')
    );
    const target: Target = { id, path: `${base}/polymers/${id}/` };
    claim(bareName(splitTitle(data.name).title), target);
    for (const a of data.abbreviation ?? []) claim(a, target);
    for (const alias of data.aliases ?? [])
      if (alias.autolinkable !== false) claim(alias.name, target);
  }

  for (const id of contentIds(join(root, 'src/content/conceptData'), '.json')) {
    const data = JSON.parse(
      readFileSync(join(root, 'src/content/conceptData', `${id}.json`), 'utf-8')
    );
    const target: Target = { id, path: `${base}/concepts/${id}/` };
    const title = bareName(splitTitle(data.name).title);
    claim(title, target);
    // Prose says "the Carothers equation", not "The Carothers Equation".
    if (/^The\s/i.test(title)) claim(title.replace(/^The\s+/i, ''), target);
    // Concept abbreviations (e.g. Tg) live in narrative frontmatter only.
    const fm = frontmatter(join(root, 'src/content/concepts', `${id}.mdx`));
    if (fm.abbreviation) {
      try {
        for (const a of JSON.parse(fm.abbreviation)) claim(a, target);
      } catch {
        /* non-array frontmatter — nothing to claim */
      }
    }
  }

  return {
    exact,
    loose,
    exactRe: boundaryRe([...exact.keys()], 'g', 'A-Za-z0-9-'),
    looseRe: boundaryRe([...loose.keys()], 'gi', 'A-Za-z0-9'),
  };
}

interface Match {
  start: number;
  end: number;
  text: string;
  target: Target;
}

function findMatches(text: string, dict: Dictionary): Match[] {
  const out: Match[] = [];
  for (const [re, lookup] of [
    [dict.exactRe, (s: string) => dict.exact.get(s)],
    [dict.looseRe, (s: string) => dict.loose.get(s.toLowerCase())],
  ] as const) {
    if (!re) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const target = lookup(m[0]);
      if (target) out.push({ start: m.index, end: m.index + m[0].length, text: m[0], target });
    }
  }
  // earliest first; on a tie, longest wins
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
};

const EXCLUDED_TAGS = new Set(['a', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function linkify(
  text: string,
  dict: Dictionary,
  selfId: string,
  linked: Set<string>
): HastNode[] | null {
  if (FORMULA_RE.test(text)) return null;
  const nodes: HastNode[] = [];
  let cursor = 0;
  for (const m of findMatches(text, dict)) {
    if (m.start < cursor) continue; // overlaps an already-taken match
    if (m.target.id === selfId || linked.has(m.target.id)) continue;
    linked.add(m.target.id);
    if (m.start > cursor) nodes.push({ type: 'text', value: text.slice(cursor, m.start) });
    nodes.push({
      type: 'element',
      tagName: 'a',
      properties: { href: m.target.path, className: ['autolink'] },
      children: [{ type: 'text', value: m.text }],
    });
    cursor = m.end;
  }
  if (!nodes.length) return null;
  if (cursor < text.length) nodes.push({ type: 'text', value: text.slice(cursor) });
  return nodes;
}

function walk(
  node: HastNode,
  excluded: boolean,
  dict: Dictionary,
  selfId: string,
  linked: Set<string>
): void {
  if (!node.children) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === 'text' && !excluded && child.value) {
      const replacement = linkify(child.value, dict, selfId, linked);
      if (replacement) {
        node.children.splice(i, 1, ...replacement);
        i += replacement.length - 1;
      }
    } else {
      const childExcluded =
        excluded || (child.type === 'element' && EXCLUDED_TAGS.has(child.tagName ?? ''));
      walk(child, childExcluded, dict, selfId, linked);
    }
  }
}

export interface AutolinkOptions {
  /** Site base path, e.g. "/PolymerAtlas" (no trailing slash). */
  base: string;
  /** Project root; defaults to process.cwd(). */
  root?: string;
}

export default function rehypeAutolink(options: AutolinkOptions) {
  let dict: Dictionary | null = null;
  return (tree: HastNode, file: { path?: string }) => {
    dict ??= buildDictionary(options.root ?? process.cwd(), options.base.replace(/\/$/, ''));
    const p = file.path ?? '';
    // Only narrative content files get autolinks (they are the only MDX).
    if (!/[\\/]src[\\/]content[\\/](polymers|concepts)[\\/]/.test(p)) return;
    const selfId = basename(p, extname(p));
    walk(tree, false, dict, selfId, new Set());
  };
}
