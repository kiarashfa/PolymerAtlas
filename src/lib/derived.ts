// Build-time derived artifacts (instructions.md §9.3) — never hand-maintained,
// never runtime-derived:
//   • catalogueIndex()  — the lightweight structured-fields JSON index that
//     powers the advanced catalogue table and the constellation layout (§8).
//     Served as /catalogue.json (src/pages/catalogue.json.ts).
//   • timelineData()    — year→entries mapping with era metadata, multi-entry
//     years first-class (§4.1). THE single data source for the timeline page
//     and /timeline.json.
//   • relatedFor(id)    — deterministic top-N related polymers per page,
//     weighted overlap across structured fields; weights live in ONE config
//     file (src/data/related-weights.json). Never hand-written.
import { loadPolymers, loadConcepts, entryPath, splitTitle, eras, eraIndex } from './content';
import weights from '../data/related-weights.json';

export interface CatalogueRecord {
  id: string;
  path: string;
  title: string;
  subtitle: string | null;
  abbreviation: string[];
  type: 'hub' | 'variant' | 'concept';
  parent: string | null;
  year: number;
  era: { index: number; name: string };
  chemical_family: string[];
  backbone_class: string | null;
  polymerization_mechanism: string[];
  polymer_class: string | null;
  application_sectors: string[];
  processing_methods: string[];
  key_figures: string[];
}

let catalogueCache: CatalogueRecord[] | null = null;

/** All entries, structured schema fields only (no prose), chronological. */
export async function catalogueIndex(): Promise<CatalogueRecord[]> {
  if (catalogueCache) return catalogueCache;
  const [polymers, concepts] = await Promise.all([loadPolymers(), loadConcepts()]);
  const records: CatalogueRecord[] = [
    ...polymers.map(({ narrative, data }): CatalogueRecord => {
      const { title, subtitle } = splitTitle(narrative.data.name);
      return {
        id: data.id,
        path: entryPath('polymer', data.id),
        title,
        subtitle,
        abbreviation: narrative.data.abbreviation,
        type: data.type,
        parent: data.parent,
        year: data.year_of_origin,
        era: { index: eraIndex(data.era), name: data.era },
        chemical_family: data.chemical_family,
        backbone_class: data.backbone_class,
        polymerization_mechanism: data.polymerization_mechanism,
        polymer_class: data.polymer_class,
        application_sectors: data.applications.map((a) => a.sector),
        processing_methods: data.processing.processing_methods,
        key_figures: data.key_figures,
      };
    }),
    ...concepts.map(({ narrative, data }): CatalogueRecord => {
      const { title, subtitle } = splitTitle(narrative.data.name);
      return {
        id: data.id,
        path: entryPath('concept', data.id),
        title,
        subtitle,
        abbreviation: narrative.data.abbreviation,
        type: 'concept',
        parent: null,
        year: data.year_of_origin,
        era: { index: eraIndex(data.era), name: data.era },
        chemical_family: [],
        backbone_class: null,
        polymerization_mechanism: [],
        polymer_class: null,
        application_sectors: [],
        processing_methods: [],
        key_figures: data.key_figures,
      };
    }),
  ];
  records.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  catalogueCache = records;
  return records;
}

export interface TimelineYear {
  year: number;
  entries: {
    id: string;
    path: string;
    title: string;
    subtitle: string | null;
    concept: boolean;
  }[];
}

export interface TimelineEra {
  index: number;
  id: string;
  name: string;
  year_start: number;
  year_end: number;
  years: TimelineYear[];
}

let timelineCache: TimelineEra[] | null = null;

export async function timelineData(): Promise<TimelineEra[]> {
  if (timelineCache) return timelineCache;
  const records = await catalogueIndex();
  timelineCache = eras.map((era, index) => {
    const inEra = records.filter((r) => r.era.index === index);
    const byYear = new Map<number, TimelineYear>();
    for (const r of inEra) {
      const entry = {
        id: r.id,
        path: r.path,
        title: r.title,
        subtitle: r.subtitle,
        concept: r.type === 'concept',
      };
      const group = byYear.get(r.year);
      if (group) group.entries.push(entry);
      else byYear.set(r.year, { year: r.year, entries: [entry] });
    }
    return {
      index,
      id: era.id,
      name: era.name,
      year_start: era.year_start,
      year_end: era.year_end,
      years: [...byYear.values()],
    };
  });
  return timelineCache;
}

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;

function score(a: CatalogueRecord, b: CatalogueRecord): number {
  return (
    overlap(a.chemical_family, b.chemical_family) * weights.chemical_family +
    overlap(a.polymerization_mechanism, b.polymerization_mechanism) *
      weights.polymerization_mechanism +
    (a.backbone_class !== null && a.backbone_class === b.backbone_class
      ? weights.backbone_class
      : 0) +
    (a.era.index === b.era.index ? weights.era : 0) +
    overlap(a.application_sectors, b.application_sectors) * weights.application_sectors +
    overlap(a.processing_methods, b.processing_methods) * weights.processing_methods
  );
}

/** Deterministic top-N related POLYMERS for one polymer page: score desc →
 *  nearest year → id. Concepts are neither candidates nor sources (no
 *  structured overlap fields). */
export async function relatedFor(id: string): Promise<(CatalogueRecord & { score: number })[]> {
  const records = await catalogueIndex();
  const self = records.find((r) => r.id === id);
  if (!self || self.type === 'concept') return [];
  return records
    .filter((r) => r.id !== id && r.type !== 'concept')
    .map((r) => ({ ...r, score: score(self, r) }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Math.abs(a.year - self.year) - Math.abs(b.year - self.year) ||
        a.id.localeCompare(b.id)
    )
    .slice(0, weights.top_n);
}
