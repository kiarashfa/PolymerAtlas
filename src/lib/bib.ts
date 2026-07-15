// Minimal BibTeX parser for references.bib — pure (no astro:content), so it
// serves both the page-render layer (content.ts) and the build-time
// integrity checks (src/integrations/integrity.ts). The real ACS-style
// citation renderer (§3.3 item 13) remains future infrastructure.

export interface BibEntry {
  key: string;
  title: string;
  publisher?: string;
  url?: string;
  note?: string;
}

export function parseBib(raw: string): Map<string, BibEntry> {
  const bib = new Map<string, BibEntry>();
  const entryRe = /@\w+\{([^,]+),([\s\S]*?)\n\}/g;
  const fieldRe = /(\w+)\s*=\s*\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(raw)) !== null) {
    const key = m[1].trim();
    const fields: Record<string, string> = {};
    let f: RegExpExecArray | null;
    while ((f = fieldRe.exec(m[2])) !== null) {
      fields[f[1].toLowerCase()] = f[2].replace(/\\'e/g, 'é').replace(/\\/g, '').trim();
    }
    bib.set(key, {
      key,
      title: fields.title ?? key,
      publisher: fields.howpublished ?? fields.publisher,
      url: fields.url,
      note: fields.note,
    });
  }
  return bib;
}
