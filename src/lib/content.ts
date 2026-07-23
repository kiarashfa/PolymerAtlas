// Content-layer plumbing for the site: data loading/joining, property-value
// display semantics, numeric citation mapping, references.bib parsing,
// era/taxonomy helpers. One source of truth — templates and pages never
// duplicate any of this logic.
import { getCollection, type CollectionEntry } from 'astro:content';
import erasData from '../data/taxonomy/eras.json';
import bibRaw from '../../references.bib?raw';
import { parseBib, type BibEntry } from './bib';
import { IMPERIAL_RULES, siText } from './units';

// ---------------------------------------------------------------- base URL --
// GitHub Pages project deploy serves under /PolymerAtlas — every
// internal link must respect BASE_URL.
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const href = (path: string) => `${base}/${path.replace(/^\//, '')}`;

/** Canonical site path for an entry (type-prefixed flat slugs —
 *  /polymers/<id>/, /concepts/<id>/, /people/<id>/, /families/<id>/; never
 *  hub/variant nesting, so URLs survive any future re-parenting unchanged). */
const KIND_PREFIX = {
  polymer: 'polymers',
  concept: 'concepts',
  person: 'people',
  family: 'families',
} as const;
export const entryPath = (kind: keyof typeof KIND_PREFIX, id: string) =>
  href(`/${KIND_PREFIX[kind]}/${id}/`);

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

export type PersonNarrative = CollectionEntry<'people'>;
export type PersonData = CollectionEntry<'personData'>['data'];
export interface PersonEntry {
  narrative: PersonNarrative;
  data: PersonData;
}

let personCache: PersonEntry[] | null = null;

/** All person entries (narrative + structured data joined by id), sorted by
 *  anchor year. Same integrity contract as the other collections. */
export async function loadPeople(): Promise<PersonEntry[]> {
  if (personCache) return personCache;
  const [narratives, dataEntries] = await Promise.all([
    getCollection('people'),
    getCollection('personData'),
  ]);
  const byId = new Map(dataEntries.map((d) => [d.data.id, d.data]));
  personCache = narratives
    .map((narrative) => {
      const data = byId.get(narrative.data.id);
      if (!data) throw new Error(`No personData file for narrative "${narrative.data.id}"`);
      return { narrative, data };
    })
    .sort(
      (a, b) =>
        a.data.year_of_origin - b.data.year_of_origin || a.data.name.localeCompare(b.data.name)
    );
  return personCache;
}

export type FamilyNarrative = CollectionEntry<'families'>;
export type FamilyData = CollectionEntry<'familyData'>['data'];
export interface FamilyEntry {
  narrative: FamilyNarrative;
  data: FamilyData;
}

let familyCache: FamilyEntry[] | null = null;

/** All compilation/family entries (narrative + structured data joined by
 *  id), alphabetical. Member lists are computed separately — see
 *  familyMembers(). */
export async function loadFamilies(): Promise<FamilyEntry[]> {
  if (familyCache) return familyCache;
  const [narratives, dataEntries] = await Promise.all([
    getCollection('families'),
    getCollection('familyData'),
  ]);
  const byId = new Map(dataEntries.map((d) => [d.data.id, d.data]));
  familyCache = narratives
    .map((narrative) => {
      const data = byId.get(narrative.data.id);
      if (!data) throw new Error(`No familyData file for narrative "${narrative.data.id}"`);
      return { narrative, data };
    })
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
  return familyCache;
}

/** One row of a browse view (catalogue/timeline). Polymers and concepts are
 *  both first-class linked entries; `concept` drives the visual distinction
 *  and the type filter. */
export interface BrowseRow {
  id: string;
  /** Canonical site path (type-prefixed flat slug). */
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
 *  Multi-entry years are expected and first-class. */
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

/** Members of a compilation page, chronological — computed from the
 *  classification tags on the polymer data files (an entry matching ANY of
 *  the page's membership tags belongs). Never hand-maintained. */
export async function familyMembers(fam: FamilyData): Promise<BrowseRow[]> {
  const polymers = await loadPolymers();
  const memberIds = new Set(
    polymers
      .filter((e) => {
        const tags =
          fam.membership.axis === 'chemical_family'
            ? e.data.chemical_family
            : e.data.polymerization_mechanism;
        return fam.membership.tags.some((t) => tags.includes(t));
      })
      .map((e) => e.data.id)
  );
  const byEra = await browseRowsByEra();
  return byEra.flatMap((g) => g.rows).filter((r) => memberIds.has(r.id));
}

/** Every entry whose key_figures names one of the given people — powers a
 *  person page's "In the Atlas" list. Chronological. */
export async function entriesFeaturing(names: string[]): Promise<BrowseRow[]> {
  const [polymers, concepts] = await Promise.all([loadPolymers(), loadConcepts()]);
  const featured = new Set(
    [...polymers.map((e) => e.narrative), ...concepts.map((c) => c.narrative)]
      .filter((n) => n.data.key_figures.some((f) => names.includes(f)))
      .map((n) => n.data.id)
  );
  const byEra = await browseRowsByEra();
  return byEra.flatMap((g) => g.rows).filter((r) => featured.has(r.id));
}

let personPathCache: Map<string, string> | null = null;

/** full name -> person-page path, for linking key_figures in heroes and
 *  data blocks. Names not in the map stay plain text (Wikipedia-link-only
 *  figures never get internal pages). */
export async function personPathsByName(): Promise<Map<string, string>> {
  if (personPathCache) return personPathCache;
  personPathCache = new Map();
  for (const p of await loadPeople())
    for (const person of p.data.people)
      personPathCache.set(person.full_name, entryPath('person', p.data.id));
  return personPathCache;
}

let familyPathCache: Map<string, string> | null = null;

/** taxonomy tag -> compilation-page path (both axes share the map — tag
 *  vocabularies don't overlap). Tags without a page stay plain chips. */
export async function familyPathsByTag(): Promise<Map<string, string>> {
  if (familyPathCache) return familyPathCache;
  familyPathCache = new Map();
  for (const f of await loadFamilies())
    for (const tag of f.data.membership.tags)
      familyPathCache.set(tag, entryPath('family', f.data.id));
  return familyPathCache;
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
 *  one chain, matching the timeline (every page sits at its own year). */
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
  /** Raw SI numbers behind `value`, present only when the unit is
   *  imperial-convertible — PropRow stamps them as data attributes for the
   *  client-side unit toggle. */
  si?: { value: number | null; min: number | null; max: number | null; unit: string };
  status: Status;
  /** Honest empty-state wording (never omit the block or fake a value). */
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
  let si: PropDisplay['si'];
  if (pv.status === 'verified' || pv.status === 'estimated') {
    const v = pv.value ?? null;
    const hasRange = pv.range_min != null && pv.range_max != null;
    const min = hasRange ? pv.range_min! : null;
    const max = hasRange ? pv.range_max! : null;
    value = siText(v, min, max, pv.unit ?? '');
    // Expose the raw SI numbers only when the unit toggle can act on them.
    if (value !== null && IMPERIAL_RULES[(pv.unit ?? '').trim()]) {
      si = { value: v, min, max, unit: pv.unit.trim() };
    }
  }
  return {
    label,
    value,
    si,
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
// One canonical section list shared by the data-block renderer and the
// section rail, so they can never drift apart.
export const SECTIONS = [
  { num: '01', id: 'identity', title: 'Identity' },
  { num: '02', id: 'classification', title: 'Classification' },
  { num: '03', id: 'history', title: 'History' },
  { num: '04', id: 'synthesis', title: 'Synthesis' },
  { num: '05', id: 'structure', title: 'Structure & Morphology' },
  { num: '06', id: 'physical', title: 'Physical Properties' },
  { num: '07', id: 'thermal', title: 'Thermal Properties' },
  { num: '08', id: 'mechanical', title: 'Mechanical Properties' },
  { num: '09', id: 'resistance', title: 'Resistance' },
  { num: '10', id: 'processing', title: 'Processing' },
  { num: '11', id: 'applications', title: 'Applications' },
  { num: '12', id: 'environmental', title: 'Environmental & Recycling' },
  { num: '13', id: 'references', title: 'References' },
] as const;

// Concept pages have their own, lighter section list (schema in
// concept-data-schema.ts — not the 13 polymer blocks).
export const CONCEPT_SECTIONS = [
  { num: '01', id: 'overview', title: 'Overview' },
  { num: '02', id: 'equations', title: 'Key Equations' },
  { num: '03', id: 'history', title: 'History' },
  { num: '04', id: 'references', title: 'References' },
] as const;

// Person pages (major historical figures).
export const PERSON_SECTIONS = [
  { num: '01', id: 'biography', title: 'Biography' },
  { num: '02', id: 'milestones', title: 'Milestones' },
  { num: '03', id: 'atlas', title: 'In the Atlas' },
  { num: '04', id: 'references', title: 'References' },
] as const;

// Compilation/family pages.
export const FAMILY_SECTIONS = [
  { num: '01', id: 'members', title: 'Members' },
  { num: '02', id: 'references', title: 'References' },
] as const;

// ------------------------------------------------------------ references.bib --
export type { BibEntry } from './bib';

/** Per-page numeric citations: in-page marks are superscript [1], [2] …
 *  that anchor into the numbered References list. The page's
 *  `references[]` array order defines the numbering. */
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
