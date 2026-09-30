// "A page to begin with": the home page opens one entry as a spread, its
// first photograph on the left and the opening of its story on the right,
// and the choice changes from day to day. Every entry is a candidate; this
// module prepares them all at build time so the reader's browser only has
// to pick one.
//
// Both halves are read from the narrative itself, never restated: the
// photograph is the story's first <Plate>, the text its opening sentences.
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import { catalogueIndex } from './derived';
import { loadPolymers, loadConcepts, eras, eraShortName } from './content';
import { parsePlates } from './plates';

export interface OpeningPage {
  id: string;
  path: string;
  title: string;
  subtitle: string | null;
  year: number;
  era: number;
  eraName: string;
  /** Whole opening sentences as HTML (italics kept, everything escaped). */
  excerpt: string;
  plate: {
    src: string;
    srcset: string;
    width: number;
    height: number;
    alt: string;
    caption: string | null;
    label: string | null;
  };
}

const images = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/**/*.{png,jpg,jpeg,webp,avif}'
);

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One paragraph of narrative MDX as reading text: a tagged molecule becomes
 *  the words it wraps, markdown emphasis becomes <em>, links become their
 *  text, and everything else is escaped. */
function proseHtml(block: string): string {
  const plain = block
    .replace(/<Mol\b[^>]*?\bname="([^"]*)"[^>]*\/>/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return escapeHtml(plain)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*]+)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
}

// A full stop after one of these is not the end of a sentence.
const NOT_A_STOP = /(?:\b[A-Z]|\b(?:Mr|Mrs|Dr|St|Co|Inc|Ltd|Jr|Sr|No|vs|ca|approx|e\.g|i\.e|cf|Fig))\.$/;

function sentences(paragraph: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?][”"’)]*(?=\s+[“"‘(]?[A-Z0-9])/g;
  for (let m = re.exec(paragraph); m; m = re.exec(paragraph)) {
    const end = m.index + m[0].length;
    if (NOT_A_STOP.test(paragraph.slice(start, m.index + 1))) continue;
    out.push(paragraph.slice(start, end).trim());
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** The opening of a story: whole paragraphs while they stay short, then
 *  whole sentences, stopping once there is enough to set the scene. */
function openingExcerpt(body: string, enough = 55, most = 125): string {
  const paragraphs = body
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b && !/^(<|#|>|-|\||```|import |export )/.test(b));
  const taken: string[] = [];
  let count = 0;
  for (const p of paragraphs) {
    if (count + words(p) <= most) {
      taken.push(proseHtml(p));
      count += words(p);
    } else {
      const part: string[] = [];
      for (const s of sentences(p)) {
        if (count >= enough) break;
        part.push(s);
        count += words(s);
      }
      if (part.length) taken.push(proseHtml(part.join(' ')));
    }
    if (count >= enough) break;
  }
  return taken.join(' ');
}

let cache: OpeningPage[] | null = null;

export async function openingPages(): Promise<OpeningPage[]> {
  if (cache) return cache;
  const [records, polymers, concepts] = await Promise.all([
    catalogueIndex(),
    loadPolymers(),
    loadConcepts(),
  ]);
  const bodies = new Map<string, string>(
    [...polymers.map((e) => e.narrative), ...concepts.map((c) => c.narrative)].map((n) => [
      n.data.id,
      n.body ?? '',
    ])
  );
  const pages: OpeningPage[] = [];
  for (const r of records) {
    const body = bodies.get(r.id) ?? '';
    const first = parsePlates(body).plates[0];
    if (!first) continue;
    const loader = images[first.src.replace(/^~\//, '../')];
    if (!loader) throw new Error(`featured: unknown asset "${first.src}" on "${r.id}"`);
    const meta = (await loader()).default;
    // Same widths and format as the narrative's own <Plate>, so the build
    // emits no second copy of the photograph.
    const img = await getImage({ src: meta, widths: [560, 900, 1400] });
    pages.push({
      id: r.id,
      path: r.path,
      title: r.title,
      subtitle: r.subtitle,
      year: r.year,
      era: r.era.index,
      eraName: eraShortName(eras[r.era.index].name),
      excerpt: openingExcerpt(body),
      plate: {
        src: img.src,
        srcset: img.srcSet.attribute,
        width: meta.width,
        height: meta.height,
        alt: first.alt,
        caption: first.caption ?? null,
        label: first.label ?? null,
      },
    });
  }
  cache = pages;
  return pages;
}

/** Which page a given day opens on. Days walk a fixed permutation of the
 *  entries (a stride coprime with their number), so consecutive days land in
 *  different eras and every entry comes round before any repeats. The same
 *  arithmetic runs in the reader's browser against their own calendar day. */
export function pageForDay(day: number, count: number): number {
  const stride = dayStride(count);
  return (((day * stride) % count) + count) % count;
}
export function dayStride(count: number): number {
  let stride = 37;
  while (gcd(stride, count) !== 1) stride++;
  return stride;
}
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
