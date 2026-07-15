// Content-layer plumbing for the site: data loading/joining, property-value
// display semantics (§3.3), numeric citation mapping, references.bib parsing,
// era/taxonomy helpers. One source of truth — templates and pages never
// duplicate any of this logic.
import { getCollection, type CollectionEntry } from 'astro:content';
import erasData from '../data/taxonomy/eras.json';
import bibRaw from '../../references.bib?raw';
import { parseBib, type BibEntry } from './bib';

// ---------------------------------------------------------------- base URL --
// GitHub Pages project deploy serves under /PolymerAtlas (§9.2) — every
// internal link must respect BASE_URL.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const href = (path: string) => `${base}/${path.replace(/^\//, '')}`;

/** Canonical site path for an entry (§9.1 locked URL scheme: type-prefixed
 *  flat slugs — /polymers/<id>/, /concepts/<id>/; never hub/variant nesting). */
export const entryPath = (kind: 'polymer' | 'concept', id: string) =>
  href(`/${kind === 'concept' ? 'concepts' : 'polymers'}/${id}/`);

// -------------------------------------------------------------------- eras --
export interface Era {
  id: string;
  name: string;
  year_start: number;
  year_end: number;
}
export const eras = erasData as Era[];

/** "The Birth of Synthetic Polymers (1907-1938): The Bakelite Revolution" -> "The Birth of Synthetic Polymers" */
export const eraShortName = (name: string) => name.replace(/\s*\(.*$/, '');

export const eraIndex = (name: string) => eras.findIndex((e) => e.name === name);

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
export const eraRoman = (name: string) => ROMAN[eraIndex(name)] ?? '?';

// ------------------------------------------------------------------ titles --
import { splitTitle } from './titles';
export { splitTitle, bareName } from './titles';

// ----------------------------------------------------------------- entries --
export type PolymerNarrative = CollectionEntry<'polymers'>;
export type PolymerData = CollectionEntry<'polymerData'>['data'];
export interface PolymerEntry {
  narrative: PolymerNarrative;
  data: PolymerData;
}

let polymerCache: PolymerEntry[] | null = null;

/** All polymer entries (narrative + structured data joined by id), sorted by
 *  year_of_origin. Every narrative MUST have a data file — enrichment is
 *  complete for all 96 entries, so a miss is a real integrity error. */
export async function loadPolymers(): Promise<PolymerEntry[]> {
  if (polymerCache) return polymerCache;
  const [narratives, dataEntries] = await Promise.all([
    getCollection('polymers'),
    getCollection('polymerData'),
  ]);
  const byId = new Map(dataEntries.map((d) => [d.data.id, d.data]));
  polymerCache = narratives
    .map((narrative) => {
      const data = byId.get(narrative.data.id);
      if (!data) throw new Error(`No polymerData file for narrative "${narrative.data.id}"`);
      return { narrative, data };
    })
    .sort(
      (a, b) =>
        a.data.year_of_origin - b.data.year_of_origin || a.data.name.localeCompare(b.data.name)
    );
  return polymerCache;
}

export type ConceptNarrative = CollectionEntry<'concepts'>;
export type ConceptData = CollectionEntry<'conceptData'>['data'];
export interface ConceptEntry {
  narrative: ConceptNarrative;
  data: ConceptData;
}

let conceptCache: ConceptEntry[] | null = null;

/** All concept entries (narrative + structured data joined by id), sorted by
 *  year_of_origin. Same integrity contract as loadPolymers: every narrative
 *  MUST have a conceptData file. */
export async function loadConcepts(): Promise<ConceptEntry[]> {
  if (conceptCache) return conceptCache;
  const [narratives, dataEntries] = await Promise.all([
    getCollection('concepts'),
    getCollection('conceptData'),
  ]);
  const byId = new Map(dataEntries.map((d) => [d.data.id, d.data]));
  conceptCache = narratives
    .map((narrative) => {
      const data = byId.get(narrative.data.id);
      if (!data) throw new Error(`No conceptData file for narrative "${narrative.data.id}"`);
      return { narrative, data };
    })
    .sort(
      (a, b) =>
        a.data.year_of_origin - b.data.year_of_origin || a.data.name.localeCompare(b.data.name)
    );
  return conceptCache;
}

/** One row of a browse view (catalogue/timeline). Polymers and concepts are
 *  both first-class linked entries; `concept` drives the visual distinction
 *  and the type filter. */
export interface BrowseRow {
  id: string;
  /** Canonical site path (type-prefixed per §9.1). */
  path: string;
  title: string;
  subtitle: string | null;
  abbreviation: string[];
  year: number;
  era: string;
  concept: boolean;
  tagline: string | null;
  /** chemical families (empty for concepts) — catalogue sorting/filtering */
  families: string[];
  /** 1-based position in overall chronological order (catalogue numbering). */
  index: number;
}

let browseCache: { era: Era; rows: BrowseRow[] }[] | null = null;

/** All 96 entries grouped by era, chronologically ordered within each era.
 *  Multi-entry years are expected and first-class (§4.1). */
export async function browseRowsByEra(): Promise<{ era: Era; rows: BrowseRow[] }[]> {
  if (browseCache) return browseCache;
  const [polymers, concepts] = await Promise.all([loadPolymers(), loadConcepts()]);
  const rows: Omit<BrowseRow, 'index'>[] = [
    ...polymers.map((e) => ({
      id: e.narrative.data.id,
      path: entryPath('polymer', e.narrative.data.id),
      ...splitTitle(e.narrative.data.name),
      abbreviation: e.narrative.data.abbreviation,
      year: e.narrative.data.year_of_origin,
      era: e.narrative.data.era,
      concept: false,
      tagline: e.narrative.data.tagline,
      families: e.data.chemical_family,
    })),
    ...concepts.map((c) => ({
      id: c.narrative.data.id,
      path: entryPath('concept', c.narrative.data.id),
      ...splitTitle(c.narrative.data.name),
      abbreviation: c.narrative.data.abbreviation,
      year: c.narrative.data.year_of_origin,
      era: c.narrative.data.era,
      concept: true,
      tagline: c.narrative.data.tagline,
      families: [],
    })),
  ];
  rows.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  const indexed: BrowseRow[] = rows.map((r, i) => ({ ...r, index: i + 1 }));
  browseCache = eras.map((era) => ({
    era,
    rows: indexed.filter((r) => r.era === era.name),
  }));
  return browseCache;
}

/** One stop on the site-wide chronological reading path. */
export interface ChronoRef {
  path: string;
  title: string;
  year: number;
  era: string;
}

let chronoCache: (ChronoRef & { id: string })[] | null = null;

/** Chronological prev/next across ALL entries — polymers and concepts share
 *  one chain, matching the timeline (every page sits at its own year, §8). */
export async function chronoNeighbours(id: string) {
  if (!chronoCache) {
    const [polymers, concepts] = await Promise.all([loadPolymers(), loadConcepts()]);
    chronoCache = [
      ...polymers.map((e) => ({
        id: e.narrative.data.id,
        path: entryPath('polymer', e.narrative.data.id),
        title: splitTitle(e.narrative.data.name).title,
        year: e.data.year_of_origin,
        era: e.data.era,
      })),
      ...concepts.map((c) => ({
        id: c.narrative.data.id,
        path: entryPath('concept', c.narrative.data.id),
        title: splitTitle(c.narrative.data.name).title,
        year: c.data.year_of_origin,
        era: c.data.era,
      })),
    ].sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  }
  const i = chronoCache.findIndex((e) => e.id === id);
  return {
    prev: i > 0 ? chronoCache[i - 1] : null,
    next: i >= 0 && i < chronoCache.length - 1 ? chronoCache[i + 1] : null,
  };
}

// --------------------------------------------------- property value display --
type Status = 'verified' | 'placeholder' | 'estimated' | 'not_applicable';

export interface PropDisplay {
  label: string;
  /** Formatted value + unit, or null when there is nothing to show. */
  value: string | null;
  status: Status;
  /** Honest empty-state wording (§3.3: never omit the block or fake a value). */
  statusText: string;
  estimated: boolean;
  conditions?: string;
  testStandard?: string;
  source?: string;
  evidenceLevel?: string;
}

const EMPTY_TEXT: Record<Status, string> = {
  verified: '',
  estimated: '',
  placeholder: 'not yet available',
  not_applicable: 'N/A — not applicable',
};

interface NumericValue {
  value: number | null;
  range_min?: number;
  range_max?: number;
  unit: string;
  conditions?: string;
  test_standard?: string;
  source?: string;
  evidence_level?: string;
  status: Status;
}

export function describeProperty(label: string, pv: NumericValue): PropDisplay {
  let value: string | null = null;
  if (pv.status === 'verified' || pv.status === 'estimated') {
    const hasRange = pv.range_min != null && pv.range_max != null;
    const range = hasRange ? `${pv.range_min}–${pv.range_max}` : null;
    let core: string | null = null;
    if (pv.value != null && range) core = `${pv.value} (${range})`;
    else if (pv.value != null) core = String(pv.value);
    else if (range) core = range;
    if (core !== null) {
      const unit = pv.unit?.trim();
      value = unit ? `${core} ${unit}` : core;
    }
  }
  return {
    label,
    value,
    status: pv.status,
    statusText: EMPTY_TEXT[pv.status],
    estimated: pv.status === 'estimated',
    conditions: pv.conditions,
    testStandard: pv.test_standard,
    source: pv.source,
    evidenceLevel: pv.evidence_level,
  };
}

interface RatedValue {
  value: string | null;
  conditions?: string;
  test_standard?: string;
  source?: string;
  evidence_level?: string;
  status: Status;
}

export function describeRated(label: string, rv: RatedValue): PropDisplay {
  const showValue =
    (rv.status === 'verified' || rv.status === 'estimated') && rv.value !== null;
  return {
    label,
    value: showValue ? rv.value : null,
    status: rv.status,
    statusText: EMPTY_TEXT[rv.status],
    estimated: rv.status === 'estimated',
    conditions: rv.conditions,
    testStandard: rv.test_standard,
    source: rv.source,
    evidenceLevel: rv.evidence_level,
  };
}

// ------------------------------------------------------------- section map --
// One canonical section list (§3.3 blocks) shared by the data-block renderer
// and any per-direction section nav, so they can never drift apart.
export const SECTIONS = [
  { num: '01', id: 'identity', title: 'Identity' },
  { num: '02', id: 'classification', title: 'Classification' },
  { num: '03', id: 'history', title: 'History' },
  { num: '04', id: 'synthesis', title: 'Synthesis' },
  { num: '05', id: 'structure', title: 'Structure & Morphology' },
  { num: '06', id: 'physical', title: 'Physical Properties' },
  { num: '07', id: 'thermal', title: 'Thermal Properties' },
  { num: '08', id: 'mechanical', title: 'Mechanical Properties' },
  { num: '09', id: 'resistance', title: 'Chemical & Environmental Resistance' },
  { num: '10', id: 'processing', title: 'Processing' },
  { num: '11', id: 'applications', title: 'Applications' },
  { num: '12', id: 'environmental', title: 'Environmental & Recycling' },
  { num: '13', id: 'references', title: 'References' },
] as const;

// Concept pages have their own, lighter section list (schema in
// concept-data-schema.ts — not the locked §3.3 blocks).
export const CONCEPT_SECTIONS = [
  { num: '01', id: 'overview', title: 'Overview' },
  { num: '02', id: 'equations', title: 'Key Equations' },
  { num: '03', id: 'history', title: 'History' },
  { num: '04', id: 'references', title: 'References' },
] as const;

// ------------------------------------------------------------ references.bib --
export type { BibEntry } from './bib';

/** Per-page numeric citations (owner decision, 2026-07-14): in-page marks are
 *  superscript [1], [2] … that anchor into the numbered References list. The
 *  page's `references[]` array order defines the numbering. */
export interface PageCitations {
  /** citation key -> 1-based number on this page */
  numberFor: Map<string, number>;
  /** ordered reference list for rendering */
  list: { n: number; key: string; bib: BibEntry }[];
}

export function citationsFor(referenceKeys: string[]): PageCitations {
  const bib = getBib();
  const numberFor = new Map<string, number>();
  const list = referenceKeys.map((key, i) => {
    numberFor.set(key, i + 1);
    return { n: i + 1, key, bib: bib.get(key) ?? { key, title: key } };
  });
  return { numberFor, list };
}

let bibCache: Map<string, BibEntry> | null = null;

export function getBib(): Map<string, BibEntry> {
  if (!bibCache) bibCache = parseBib(bibRaw);
  return bibCache;
}
