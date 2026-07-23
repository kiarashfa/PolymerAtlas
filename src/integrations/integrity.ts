// Build-time content integrity checks — anything that must gate the cloud
// build lives HERE, in committed code, wired into `astro build` itself.
//
// Division of labour: the Zod content-collection schemas already validate
// shape, taxonomy tags (semi-controlled enums from src/data/taxonomy/), and
// era validity per file. This integration covers the CROSS-FILE invariants
// Zod cannot see:
//   1. narrative ↔ data files pair 1:1, both directions, ids match filenames
//   2. narrative frontmatter era/year agree with the data file's
//   3. every `source` citation key used anywhere in a data file resolves
//      into references.bib AND is listed in that entry's own references[]
//   4. every references[] key resolves into references.bib
//   5. every references.bib entry is complete (title, publisher, URL)
// Any violation fails the build with the full list, not just the first.
import type { AstroIntegration } from 'astro';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBib } from '../lib/bib';
import { contentIds as ids, frontmatter } from '../lib/scan';

/** Every string under a `source` key, anywhere in the data JSON tree, is a
 *  citation key (property values, rated values, key_equations). */
function collectSources(node: unknown, out: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectSources(item, out);
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'source' && typeof v === 'string') out.add(v);
      else collectSources(v, out);
    }
  }
}

function checkPair(
  root: string,
  narrativeDir: string,
  dataDir: string,
  errors: string[],
  /** Compilation pages have no year/era of their own (a family spans the
   *  whole timeline) — pass false to skip the chronology agreement checks. */
  dated = true
): void {
  const nIds = ids(join(root, narrativeDir), '.mdx');
  const dIds = ids(join(root, dataDir), '.json');
  for (const id of nIds)
    if (!dIds.includes(id)) errors.push(`${narrativeDir}/${id}.mdx has no ${dataDir}/${id}.json`);
  for (const id of dIds)
    if (!nIds.includes(id)) errors.push(`${dataDir}/${id}.json has no ${narrativeDir}/${id}.mdx`);

  for (const id of nIds) {
    const fm = frontmatter(join(root, narrativeDir, `${id}.mdx`));
    if (fm.id !== id)
      errors.push(`${narrativeDir}/${id}.mdx frontmatter id "${fm.id}" ≠ filename`);
    if (dated && !fm.era) errors.push(`${narrativeDir}/${id}.mdx has no era`);
    if (!dIds.includes(id)) continue;
    const data = JSON.parse(readFileSync(join(root, dataDir, `${id}.json`), 'utf-8'));
    if (data.id !== id) errors.push(`${dataDir}/${id}.json id "${data.id}" ≠ filename`);
    if (!dated) continue;
    if (fm.era && data.era !== fm.era)
      errors.push(`${id}: era differs between narrative ("${fm.era}") and data ("${data.era}")`);
    if (fm.year_of_origin && data.year_of_origin !== Number(fm.year_of_origin))
      errors.push(
        `${id}: year_of_origin differs between narrative (${fm.year_of_origin}) and data (${data.year_of_origin})`
      );
  }
}

function checkCitations(root: string, dataDir: string, errors: string[]): void {
  const bib = parseBib(readFileSync(join(root, 'references.bib'), 'utf-8'));
  for (const id of ids(join(root, dataDir), '.json')) {
    const data = JSON.parse(readFileSync(join(root, dataDir, `${id}.json`), 'utf-8'));
    const listed: string[] = Array.isArray(data.references) ? data.references : [];
    const used = new Set<string>();
    collectSources(data, used);
    for (const key of used) {
      if (!bib.has(key)) errors.push(`${dataDir}/${id}.json cites "${key}" — not in references.bib`);
      if (!listed.includes(key))
        errors.push(`${dataDir}/${id}.json cites "${key}" — missing from its references[]`);
    }
    for (const key of listed)
      if (!bib.has(key))
        errors.push(`${dataDir}/${id}.json lists "${key}" — not in references.bib`);
  }
}

function checkBibComplete(root: string, errors: string[]): void {
  const bib = parseBib(readFileSync(join(root, 'references.bib'), 'utf-8'));
  for (const entry of bib.values()) {
    const missing = [
      !entry.title || entry.title === entry.key ? 'title' : null,
      !entry.publisher ? 'howpublished/publisher' : null,
      !entry.url ? 'url' : null,
    ].filter(Boolean);
    if (missing.length)
      errors.push(`references.bib entry "${entry.key}" is incomplete: missing ${missing.join(', ')}`);
  }
}

export default function integrity(): AstroIntegration {
  let root = '';
  return {
    name: 'polymer-atlas-integrity',
    hooks: {
      'astro:config:done': ({ config }) => {
        root = fileURLToPath(config.root);
      },
      'astro:build:start': ({ logger }) => {
        const errors: string[] = [];
        checkPair(root, 'src/content/polymers', 'src/content/polymerData', errors);
        checkPair(root, 'src/content/concepts', 'src/content/conceptData', errors);
        checkPair(root, 'src/content/people', 'src/content/personData', errors);
        checkPair(root, 'src/content/families', 'src/content/familyData', errors, false);
        checkCitations(root, 'src/content/polymerData', errors);
        checkCitations(root, 'src/content/conceptData', errors);
        checkCitations(root, 'src/content/personData', errors);
        checkCitations(root, 'src/content/familyData', errors);
        checkBibComplete(root, errors);
        if (errors.length) {
          throw new Error(
            `Content integrity check failed (${errors.length} violation${errors.length === 1 ? '' : 's'}):\n` +
              errors.map((e) => `  ✗ ${e}`).join('\n')
          );
        }
        logger.info('content integrity ✓ (pairing, citations, references.bib)');
      },
    },
  };
}
