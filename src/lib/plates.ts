// Reading <Plate> tags back out of a narrative MDX file.
//
// Placement is authored in the MDX (that is where a photograph's position in
// the story is a real editorial decision), while the dataset separately
// records every image as a structured object with its licence and
// attribution. Rather than ask anyone to keep two copies in step by hand,
// the MDX is the single authoring surface: this parser is what the
// build-time integrity check and the dataset sync both read, so they can
// never disagree about what a page actually contains.

export interface PlateRef {
  src: string;
  alt: string;
  caption?: string;
  source_url?: string;
  author?: string;
  license?: string;
  attribution_text?: string;
  label?: string;
}

const TAG = /<Plate\b([^>]*?)\/>/gs;
const ATTR = /([a-zA-Z_][\w]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/g;

const REQUIRED = ['src', 'alt', 'source_url', 'author', 'license'] as const;

/** Every <Plate> in the file, in document order, plus any authoring
 *  mistakes found while reading them. */
export function parsePlates(mdx: string): { plates: PlateRef[]; errors: string[] } {
  const plates: PlateRef[] = [];
  const errors: string[] = [];

  for (const tag of mdx.matchAll(TAG)) {
    const attrs: Record<string, string> = {};
    for (const a of tag[1].matchAll(ATTR)) {
      const [, name, dq, sq, expr] = a;
      if (expr !== undefined) {
        errors.push(`<Plate ${name}={…}> — plate props must be plain quoted strings`);
        continue;
      }
      attrs[name] = (dq ?? sq ?? '').trim();
    }
    const missing = REQUIRED.filter((k) => !attrs[k]);
    if (missing.length) {
      errors.push(`<Plate src="${attrs.src ?? '?'}"> is missing ${missing.join(', ')}`);
      continue;
    }
    if (!attrs.src.startsWith('~/assets/')) {
      errors.push(`<Plate src="${attrs.src}"> must be a "~/assets/…" path`);
      continue;
    }
    plates.push(attrs as unknown as PlateRef);
  }
  return { plates, errors };
}

/** The dataset's structured image record, derived from a plate tag. */
export function plateToImageObject(p: PlateRef) {
  return {
    src: p.src,
    alt: p.alt,
    ...(p.caption ? { caption: p.caption } : {}),
    source_url: p.source_url!,
    author: p.author!,
    license: p.license!,
    ...(p.attribution_text ? { attribution_text: p.attribution_text } : {}),
  };
}
