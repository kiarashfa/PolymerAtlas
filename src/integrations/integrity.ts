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
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBib } from '../lib/bib';
import { contentIds as ids, frontmatter, frontmatterList } from '../lib/scan';
import { parsePlates } from '../lib/plates';
import { sameAtoms } from '../lib/formula';

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
    // key_figures is authored in BOTH files and read from both — the hero and
    // the person-page cross-linking use the narrative's copy, the History
    // block uses the data file's. A divergence renders as two different
    // answers on one page, so they have to agree exactly, order included.
    const fmFigures = frontmatterList(fm.key_figures);
    if (fmFigures && Array.isArray(data.key_figures)) {
      const a = fmFigures.join(' | ');
      const b = (data.key_figures as string[]).join(' | ');
      if (a !== b)
        errors.push(
          `${id}: key_figures differ between narrative ([${a}]) and data ([${b}])`
        );
    }
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

/** Narrative <Plate> tags and the data file's historical_images[] describe
 *  the same photographs. The MDX is the authoring surface; the array is
 *  derived from it (scripts/story-refinement/sync-images.mjs), so a
 *  disagreement means the sync was not run and the published provenance
 *  record no longer matches the page. */
function checkPlates(
  root: string,
  narrativeDir: string,
  dataDir: string,
  errors: string[]
): void {
  for (const id of ids(join(root, narrativeDir), '.mdx')) {
    const mdx = readFileSync(join(root, narrativeDir, `${id}.mdx`), 'utf-8');
    const { plates, errors: bad } = parsePlates(mdx);
    for (const e of bad) errors.push(`${narrativeDir}/${id}.mdx: ${e}`);

    const dataPath = join(root, dataDir, `${id}.json`);
    if (!existsSync(dataPath)) continue;
    const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
    const recorded: { src?: string }[] = Array.isArray(data.historical_images)
      ? data.historical_images
      : [];

    const inMdx = new Set(plates.map((p) => p.src));
    const inData = new Set(recorded.map((r) => r.src ?? ''));
    for (const src of inMdx)
      if (!inData.has(src))
        errors.push(`${id}: <Plate src="${src}"> is not in historical_images[] — run sync-images`);
    for (const src of inData)
      if (!inMdx.has(src))
        errors.push(`${id}: historical_images[] lists "${src}" with no <Plate> in the narrative`);
  }
}

/** A hand-written structural formula must describe exactly the atoms of the
 *  machine-derived empirical one. sameAtoms returns null for notation it
 *  cannot count honestly (R groups, variable substitution) — that is "cannot
 *  tell", not a failure. */
function checkFormulas(root: string, dataDir: string, errors: string[]): void {
  for (const id of ids(join(root, dataDir), '.json')) {
    const data = JSON.parse(readFileSync(join(root, dataDir, `${id}.json`), 'utf-8'));
    const f = data.chemical_formula;
    if (!f?.empirical || !f?.structural) continue;
    if (sameAtoms(f.empirical, f.structural) === false)
      errors.push(
        `${dataDir}/${id}.json: structural formula "${f.structural}" does not have the same atoms as empirical "${f.empirical}"`
      );
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
        checkPlates(root, 'src/content/polymers', 'src/content/polymerData', errors);
        checkPlates(root, 'src/content/concepts', 'src/content/conceptData', errors);
        checkPlates(root, 'src/content/people', 'src/content/personData', errors);
        checkPlates(root, 'src/content/families', 'src/content/familyData', errors);
        checkFormulas(root, 'src/content/polymerData', errors);
        checkBibComplete(root, errors);
        if (errors.length) {
          throw new Error(
            `Content integrity check failed (${errors.length} violation${errors.length === 1 ? '' : 's'}):\n` +
              errors.map((e) => `  ✗ ${e}`).join('\n')
          );
        }
        logger.info('content integrity ✓ (pairing, citations, references.bib, plates, formulas)');
      },
    },
  };
}
