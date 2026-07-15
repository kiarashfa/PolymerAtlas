// Content-file scanning helpers — pure node:fs, shared by the build-time
// integrity integration and the autolink dictionary builder (both run
// outside the Astro container, where astro:content is unavailable).
import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';

export const contentIds = (dir: string, ext: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => basename(f, ext));

/** The splitter writes simple `key: "value"` / `key: [...]` frontmatter; a
 *  missed parse surfaces as a failed check downstream, never a silent pass. */
export function frontmatter(path: string): Record<string, string> {
  const raw = readFileSync(path, 'utf-8');
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out: Record<string, string> = {};
  if (!fm) return out;
  for (const line of fm[1].split(/\r?\n/)) {
    const m = line.match(/^(\w+):\s*(?:"(.*)"|(\S.*))\s*$/);
    if (m) out[m[1]] = m[2] ?? m[3];
  }
  return out;
}
