// The Compare tool's data, prepared at build time: every polymer's property
// values exactly as its entry page shows them (same catalogue, same status
// semantics, same citation keys), plus the atlas-wide spread of each
// plottable property, which is what gives a chart its scale. Nothing here is
// computed from anything but the data files; nothing is predicted.
import {
  loadPolymers,
  entryPath,
  splitTitle,
  bareName,
  eras,
  eraShortName,
  eraIndex,
  getBib,
  href,
} from './content';
import { NUMERIC, RATED, type NumericProp } from './properties';

/** One value: `s` is the status initial (v/e/p/n = verified, estimated,
 *  placeholder, not applicable); numbers are SI, as stored. */
export interface CmpValue {
  s: 'v' | 'e' | 'p' | 'n';
  v?: number | null;
  lo?: number;
  hi?: number;
  u?: string;
  /** rated (categorical) value text */
  t?: string;
  c?: string;
  std?: string;
  src?: string;
}

export interface CmpPolymer {
  id: string;
  path: string;
  title: string;
  /** Abbreviation when there is one, the bare name otherwise: for chart labels. */
  short: string;
  year: number;
  era: number;
  eraName: string;
  /** Every searchable name, lower-cased, for the picker. */
  names: string;
  structure: string | null;
  facts: {
    polymer_class: string | null;
    family: string[];
    backbone: string | null;
    mechanism: string[];
    type: 'hub' | 'variant';
    parent: string | null;
    recyclable: boolean | null;
    biodegradable: boolean | null;
    drying: boolean | null;
    methods: string[];
    resin: string | null;
    sectors: string[];
  };
  props: Record<string, CmpValue>;
  gas: Record<string, CmpValue>;
}

export interface CmpPropMeta {
  key: string;
  label: string;
  group: string;
  kind: 'num' | 'rated';
  unit: string | null;
  chartable: boolean;
  /** Atlas-wide extent of the stored values (SI), for chartable ones. */
  min?: number;
  max?: number;
  /** Plot on a log scale: the values span two orders of magnitude or more. */
  log?: boolean;
  /** How many polymers have a value (verified or estimated). */
  count: number;
}

export interface CompareData {
  polymers: CmpPolymer[];
  props: CmpPropMeta[];
  groups: { id: string; title: string }[];
  bib: Record<string, { title: string; publisher?: string; url?: string }>;
}

const GROUPS = [
  { id: 'physical', title: 'Physical' },
  { id: 'thermal', title: 'Thermal' },
  { id: 'mechanical', title: 'Mechanical' },
  { id: 'resistance', title: 'Resistance' },
  { id: 'processing', title: 'Processing' },
  { id: 'molecularWeight', title: 'Molecular weight' },
  { id: 'morphology', title: 'Morphology' },
  { id: 'toxicity', title: 'Toxicity & safety' },
] as const;

const STATUS = { verified: 'v', estimated: 'e', placeholder: 'p', not_applicable: 'n' } as const;

// Which polymers have a drawing; the files themselves are served at
// /structures/<id>.svg (src/pages/structures/[id].svg.ts). Not asset URLs:
// the bundler inlines small files instead of emitting them, which would
// leave a URL pointing at nothing.
const drawings = import.meta.glob<string>('../assets/structures/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const drawn = new Set(Object.keys(drawings).map((path) => path.split('/').pop()!.replace(/\.svg$/, '')));
const structureUrl = (id: string) => (drawn.has(id) ? href(`/structures/${id}.svg`) : null);

type AnyValue = {
  value: number | string | null;
  range_min?: number;
  range_max?: number;
  unit?: string;
  conditions?: string;
  test_standard?: string;
  source?: string;
  status: keyof typeof STATUS;
};

function pack(pv: AnyValue): CmpValue {
  const s = STATUS[pv.status];
  const out: CmpValue = { s };
  if (s === 'v' || s === 'e') {
    if (typeof pv.value === 'string') out.t = pv.value;
    else {
      out.v = pv.value;
      if (pv.range_min != null && pv.range_max != null) {
        out.lo = pv.range_min;
        out.hi = pv.range_max;
      }
      out.u = (pv.unit ?? '').trim();
    }
    if (pv.conditions) out.c = pv.conditions;
    if (pv.test_standard) out.std = pv.test_standard;
    if (pv.source) out.src = pv.source;
  }
  return out;
}

let cache: CompareData | null = null;

export async function compareData(): Promise<CompareData> {
  if (cache) return cache;
  const entries = await loadPolymers();
  const bib = getBib();
  const usedKeys = new Set<string>();

  const numeric = GROUPS.flatMap((g) =>
    ((NUMERIC as Record<string, NumericProp[]>)[g.id] ?? []).map((p) => ({ ...p, group: g.id }))
  );
  const rated = GROUPS.flatMap((g) =>
    ((RATED as Record<string, { key: string; label: string; get: (d: never) => unknown }[]>)[g.id] ?? []).map(
      (p) => ({ ...p, group: g.id })
    )
  );

  const polymers: CmpPolymer[] = entries.map(({ narrative, data }) => {
    const { title } = splitTitle(narrative.data.name);
    const props: Record<string, CmpValue> = {};
    for (const p of numeric) {
      const pv = p.get(data);
      if (pv) props[p.key] = pack(pv as AnyValue);
    }
    for (const p of rated) props[p.key] = pack((p.get as (d: typeof data) => AnyValue)(data));
    const gas: Record<string, CmpValue> = {};
    for (const g of data.chemical_resistance.gas_permeability) gas[g.key] = pack(g as AnyValue);
    for (const v of [...Object.values(props), ...Object.values(gas)]) if (v.src) usedKeys.add(v.src);
    const names = [
      title,
      ...data.abbreviation,
      ...data.synonyms,
      ...data.aliases.map((a) => a.name),
    ]
      .join(' · ')
      .toLowerCase();
    return {
      id: data.id,
      path: entryPath('polymer', data.id),
      title,
      short: data.abbreviation[0] ?? bareName(title),
      year: data.year_of_origin,
      era: eraIndex(data.era),
      eraName: eraShortName(eras[eraIndex(data.era)].name),
      names,
      structure: structureUrl(data.id),
      facts: {
        polymer_class: data.polymer_class,
        family: data.chemical_family,
        backbone: data.backbone_class,
        mechanism: data.polymerization_mechanism,
        type: data.type,
        parent: data.parent,
        recyclable: data.environmental.recyclable,
        biodegradable: data.environmental.biodegradable,
        drying: data.processing.drying_required,
        methods: data.processing.processing_methods,
        resin: data.resin_id_code,
        sectors: data.applications.map((a) => a.sector),
      },
      props,
      gas,
    };
  });

  const has = (v: CmpValue | undefined) => !!v && (v.s === 'v' || v.s === 'e');
  const props: CmpPropMeta[] = [
    ...numeric.map((p) => {
      const vals = polymers.map((x) => x.props[p.key]).filter(has);
      const nums = vals.flatMap((v) => [v.v, v.lo, v.hi]).filter((x): x is number => typeof x === 'number');
      const units = new Set(vals.map((v) => v.u).filter(Boolean));
      const meta: CmpPropMeta = {
        key: p.key,
        label: p.label,
        group: p.group,
        kind: 'num',
        unit: units.size === 1 ? [...units][0]! : null,
        // A property is plotted only when every value shares one unit.
        chartable: p.chartable && units.size <= 1 && nums.length >= 2,
        count: vals.length,
      };
      if (meta.chartable && nums.length) {
        meta.min = Math.min(...nums);
        meta.max = Math.max(...nums);
        meta.log = meta.min > 0 && meta.max / meta.min >= 100;
      }
      return meta;
    }),
    ...rated.map(
      (p): CmpPropMeta => ({
        key: p.key,
        label: p.label,
        group: p.group,
        kind: 'rated',
        unit: null,
        chartable: false,
        count: polymers.filter((x) => has(x.props[p.key])).length,
      })
    ),
  ];

  const bibOut: CompareData['bib'] = {};
  for (const key of usedKeys) {
    const b = bib.get(key);
    if (b) bibOut[key] = { title: b.title, publisher: b.publisher, url: b.url };
  }

  polymers.sort((a, b) => a.title.localeCompare(b.title));
  cache = { polymers, props, groups: GROUPS.map((g) => ({ ...g })), bib: bibOut };
  return cache;
}
