// The Compare tool, in the browser: the picker, the four views and the URL.
// Reads the dataset the page carries (see compare-data.ts) and never fetches
// anything but the structure drawings.
//
// Colour follows the SLOT, never the rank: the first polymer is always
// --series-1, and removing it leaves the others their colours. Every chart
// is drawn in the reader's unit system and redrawn when it changes.
import type { CompareData, CmpPolymer, CmpPropMeta, CmpValue } from './compare-data';
import { valueText, inSystem, storedUnits, UNITS_CHANGE_EVENT, type UnitSystem } from './units';

type View = 'table' | 'radar' | 'range' | 'map';
const SLOTS = 3;
const DEFAULT_CHART = [
  'density',
  'tg',
  'tensile_modulus',
  'tensile_strength_at_break',
  'elongation_at_break',
  'decomposition_onset',
];
const DEFAULT_MAP: [string, string] = ['density', 'tensile_modulus'];
const SVGNS = 'http://www.w3.org/2000/svg';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const has = (v: CmpValue | undefined): v is CmpValue => !!v && (v.s === 'v' || v.s === 'e');
/** The number a chart places: the value, or the middle of a range given alone. */
const point = (v: CmpValue): number | null =>
  typeof v.v === 'number' ? v.v : v.lo != null && v.hi != null ? (v.lo + v.hi) / 2 : null;

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => (n < 0 ? '⁻' : '') + [...String(Math.abs(n))].map((d) => SUP[+d]).join('');

/** A tick or axis label: short, and in typeset powers of ten where needed. */
function fmt(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e6 || a < 1e-3) {
    const e = Math.floor(Math.log10(a));
    const m = Number((v / 10 ** e).toPrecision(2));
    return m === 1 ? `10${sup(e)}` : `${m} × 10${sup(e)}`;
  }
  const n = Number(v.toPrecision(3));
  return a >= 1000 ? n.toLocaleString('en-US') : String(n);
}

/** Round tick values across [lo, hi]: about `count` of them, on 1-2-5 steps. */
function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (hi <= lo) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}
function decadeTicks(lo: number, hi: number): number[] {
  const out: number[] = [];
  const a = Math.ceil(Math.log10(lo) - 1e-9);
  const b = Math.floor(Math.log10(hi) + 1e-9);
  const every = Math.max(1, Math.ceil((b - a + 1) / 7));
  for (let e = a; e <= b; e += every) out.push(10 ** e);
  return out;
}

/** An axis for one property, in the reader's units, over the whole Atlas. */
interface Axis {
  meta: CmpPropMeta;
  unit: string;
  lo: number;
  hi: number;
  log: boolean;
  /** 0..1 position of a value given in the reader's units */
  t: (v: number) => number;
  /** an SI value into the reader's units */
  conv: (v: number) => number;
  ticks: number[];
  /** a tick's label: on a log axis spanning many decades every decade is a
   *  power of ten, so one axis never mixes "1,000" with "10⁵" */
  label: (v: number) => string;
}
function axisFor(meta: CmpPropMeta, system: UnitSystem): Axis {
  const unit = meta.unit ?? '';
  const conv = (v: number) => inSystem(v, unit, system).v;
  const du = inSystem(1, unit, system).unit;
  let lo = conv(meta.min!);
  let hi = conv(meta.max!);
  if (lo > hi) [lo, hi] = [hi, lo];
  const log = !!meta.log;
  if (!log && lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const t = log
    ? (v: number) => (v > 0 ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo) || 1) : 0)
    : (v: number) => (v - lo) / (hi - lo);
  const ticks = log ? decadeTicks(lo, hi) : niceTicks(lo, hi);
  const powers = log && Math.log10(hi / lo) > 5;
  const label = (v: number) => (powers ? `10${sup(Math.round(Math.log10(v)))}` : fmt(v));
  return { meta, unit: du, lo, hi, log, t, conv, ticks, label };
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text != null) node.textContent = text;
  return node;
}

export function initCompare() {
  const root = document.querySelector<HTMLElement>('[data-compare]');
  const dataEl = document.querySelector('[data-compare-data]');
  if (!root || !dataEl) return;
  const data: CompareData = JSON.parse(dataEl.textContent ?? '{}');
  const byId = new Map(data.polymers.map((p) => [p.id, p]));
  const metaByKey = new Map(data.props.map((p) => [p.key, p]));
  const chartable = data.props.filter((p) => p.chartable && p.count >= 5);
  const stage = root.querySelector<HTMLElement>('[data-stage]')!;
  const tip = root.querySelector<HTMLElement>('[data-tip]')!;
  const card = root.querySelector<HTMLElement>('[data-view-card]')!;

  // ---------------------------------------------------------------- state --
  const q = new URLSearchParams(location.search);
  const slots: (string | null)[] = Array.from({ length: SLOTS }, (_, i) => {
    const id = (q.get('p') ?? '').split(',')[i]?.trim();
    return id && byId.has(id) ? id : null;
  });
  let view: View = (['table', 'radar', 'range', 'map'] as View[]).includes(q.get('view') as View)
    ? (q.get('view') as View)
    : 'table';
  const chartKeys = new Set(
    (q.get('props') ?? '').split(',').filter((k) => chartable.some((c) => c.key === k))
  );
  if (!chartKeys.size) DEFAULT_CHART.forEach((k) => chartable.some((c) => c.key === k) && chartKeys.add(k));
  let mapX = metaByKey.get(q.get('x') ?? '')?.chartable ? q.get('x')! : DEFAULT_MAP[0];
  let mapY = metaByKey.get(q.get('y') ?? '')?.chartable ? q.get('y')! : DEFAULT_MAP[1];
  let showEmpty = false;
  let checksOpen = false;
  let system: UnitSystem = storedUnits();

  const chosen = () =>
    slots.map((id, i) => (id ? { p: byId.get(id)!, i } : null)).filter((x): x is { p: CmpPolymer; i: number } => !!x);

  // Written by hand rather than through URLSearchParams, which would encode
  // every comma: ids and property keys are plain slugs, and a shared link
  // should read as ?p=nylon,polycarbonate,polyether-ether-ketone.
  function writeUrl() {
    const parts: string[] = [];
    if (slots.some(Boolean)) parts.push(`p=${slots.map((s) => s ?? '').join(',').replace(/,+$/, '')}`);
    if (view !== 'table') parts.push(`view=${view}`);
    if (view === 'radar' || view === 'range') parts.push(`props=${[...chartKeys].join(',')}`);
    if (view === 'map') parts.push(`x=${mapX}`, `y=${mapY}`);
    history.replaceState(history.state, '', parts.length ? `?${parts.join('&')}` : location.pathname);
  }

  // --------------------------------------------------------------- picker --
  function renderSlots() {
    root!.querySelectorAll<HTMLElement>('[data-slot]').forEach((slotEl) => {
      const i = Number(slotEl.dataset.slot);
      const body = slotEl.querySelector<HTMLElement>('[data-slot-body]')!;
      const id = slots[i];
      if (id) {
        const p = byId.get(id)!;
        body.innerHTML = `<div class="cmp-chosen">
            <span class="cmp-swatch" aria-hidden="true"></span>
            <span class="cmp-chosen-text"><a href="${p.path}">${esc(p.title)}</a>
              <span class="cmp-chosen-meta">${p.year} · ${esc(p.eraName)}</span></span>
            <button class="cmp-remove" type="button" data-remove="${i}" aria-label="Remove ${esc(p.title)}" title="Remove">×</button>
          </div>`;
      } else {
        body.innerHTML = `<div class="cmp-combo">
            <input class="tool-input cmp-input" id="cmp-in-${i}" type="text" autocomplete="off" spellcheck="false"
              placeholder="Add a polymer…" role="combobox" aria-expanded="false" aria-controls="cmp-list-${i}" />
            <ul class="cmp-options" id="cmp-list-${i}" role="listbox" hidden></ul>
          </div>`;
        wireCombo(body, i);
      }
    });
  }

  function matches(query: string): CmpPolymer[] {
    const taken = new Set(slots.filter(Boolean));
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = data.polymers.filter((p) => !taken.has(p.id));
    if (!words.length) return pool;
    const score = (p: CmpPolymer) => {
      const t = p.title.toLowerCase();
      const s = p.short.toLowerCase();
      if (s === query.toLowerCase()) return 0;
      if (t.startsWith(query.toLowerCase())) return 1;
      return 2;
    };
    return pool.filter((p) => words.every((w) => p.names.includes(w))).sort((a, b) => score(a) - score(b));
  }

  function wireCombo(body: HTMLElement, i: number) {
    const input = body.querySelector<HTMLInputElement>('input')!;
    const list = body.querySelector<HTMLUListElement>('ul')!;
    let active = 0;
    let items: CmpPolymer[] = [];
    const open = () => {
      items = matches(input.value);
      active = 0;
      list.innerHTML = items.length
        ? items
            .map(
              (p, k) => `<li role="option" class="cmp-option${k === 0 ? ' is-active' : ''}" data-pick="${p.id}"
                 aria-selected="${k === 0}"><span>${esc(p.title)}</span><span class="cmp-option-year">${p.year}</span></li>`
            )
            .join('')
        : '<li class="cmp-option cmp-option--none">No polymer in the Atlas by that name</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };
    const close = () => {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    };
    const mark = () =>
      list.querySelectorAll<HTMLElement>('[data-pick]').forEach((li, k) => {
        li.classList.toggle('is-active', k === active);
        li.setAttribute('aria-selected', String(k === active));
        if (k === active) li.scrollIntoView({ block: 'nearest' });
      });
    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('blur', () => setTimeout(close, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (list.hidden) open();
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
        mark();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (items[active]) pick(i, items[active].id);
      } else if (e.key === 'Escape') {
        close();
      }
    });
    // pointerdown, not click: pressing an option blurs the input first, and
    // by the time a click lands the list would already be closing.
    list.addEventListener('pointerdown', (e) => {
      const li = (e.target as Element).closest<HTMLElement>('[data-pick]');
      if (!li) return;
      e.preventDefault();
      pick(i, li.dataset.pick!);
    });
  }

  function pick(i: number, id: string) {
    slots[i] = id;
    renderSlots();
    render();
    // Carry on filling: focus the next empty slot, if any.
    const next = slots.findIndex((s) => !s);
    if (next >= 0 && chosen().length < SLOTS) root!.querySelector<HTMLInputElement>(`#cmp-in-${next}`)?.focus();
  }

  root.addEventListener('click', (e) => {
    const t = e.target as Element;
    const rm = t.closest<HTMLElement>('[data-remove]');
    if (rm) {
      slots[Number(rm.dataset.remove)] = null;
      renderSlots();
      render();
      return;
    }
    const ex = t.closest<HTMLElement>('[data-example]');
    if (ex) {
      const ids = ex.dataset.example!.split(',');
      for (let k = 0; k < SLOTS; k++) slots[k] = ids[k] && byId.has(ids[k]) ? ids[k] : null;
      renderSlots();
      render();
      return;
    }
    const tab = t.closest<HTMLElement>('[data-view]');
    if (tab) {
      view = tab.dataset.view as View;
      root!.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => {
        b.classList.toggle('is-active', b === tab);
        b.setAttribute('aria-selected', String(b === tab));
      });
      render();
      return;
    }
    const chip = t.closest<HTMLElement>('[data-chart-key]');
    if (chip) {
      const k = chip.dataset.chartKey!;
      if (chartKeys.has(k)) chartKeys.delete(k);
      else chartKeys.add(k);
      render();
      return;
    }
    if (t.closest('[data-show-empty]')) {
      showEmpty = !showEmpty;
      render();
      return;
    }
    const add = t.closest<SVGElement>('[data-add]');
    if (add) {
      const free = slots.findIndex((s) => !s);
      if (free >= 0) pick(free, add.dataset.add!);
    }
  });
  // Remember whether the checklist is unfolded across redraws.
  root.addEventListener(
    'toggle',
    (e) => {
      const d = e.target as HTMLDetailsElement;
      if (!d.matches?.('[data-checks]')) return;
      checksOpen = d.open;
      const edit = d.querySelector('.cmp-count-edit');
      if (edit) edit.textContent = d.open ? 'done' : 'change';
    },
    true
  );
  root.addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    if (sel.matches('[data-map-x]')) mapX = sel.value;
    else if (sel.matches('[data-map-y]')) mapY = sel.value;
    else return;
    render();
  });

  // ----------------------------------------------------------------- tips --
  card.addEventListener('pointerover', (e) => {
    const target = (e.target as Element).closest<Element>('[data-tipx]');
    if (!target) return;
    tip.innerHTML = target.getAttribute('data-tipx') ?? '';
    tip.hidden = false;
  });
  card.addEventListener('pointermove', (e) => {
    if (tip.hidden) return;
    const box = card.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(8, x - w / 2), box.width - w - 8)}px`;
    tip.style.top = `${y - tip.offsetHeight - 14}px`;
  });
  card.addEventListener('pointerout', (e) => {
    if ((e.target as Element).closest('[data-tipx]')) tip.hidden = true;
  });

  // ---------------------------------------------------------------- views --
  function render() {
    tip.hidden = true;
    writeUrl();
    const sel = chosen();
    root!.classList.toggle('has-selection', sel.length > 0);
    if (!sel.length && view !== 'map') {
      stage.innerHTML = '<p class="cmp-empty">Choose a polymer above to begin, or try one of the sets.</p>';
      return;
    }
    if (view === 'table') renderTable(sel);
    else if (view === 'radar') renderRadar(sel);
    else if (view === 'range') renderRange(sel);
    else renderMap(sel);
  }

  const tipFor = (p: CmpPolymer, meta: CmpPropMeta, v: CmpValue) =>
    `<b>${esc(p.short)}</b> · ${esc(meta.label)}<br>${esc(valueText(v.v ?? null, v.lo ?? null, v.hi ?? null, v.u ?? '', system) ?? '')}` +
    (v.s === 'e' ? ' <i>(estimate)</i>' : '');

  // --- table ------------------------------------------------------------------
  function renderTable(sel: { p: CmpPolymer; i: number }[]) {
    // Sources are numbered in the order the table first cites them, as on
    // an entry page, and listed beneath it.
    const cites = new Map<string, number>();
    const cite = (key?: string) => {
      if (!key) return '';
      if (!cites.has(key)) cites.set(key, cites.size + 1);
      const n = cites.get(key)!;
      const title = data.bib[key]?.title ?? key;
      return `<a class="cite" href="#cmp-src-${n}" title="${esc(title)}"><sup>[${n}]</sup></a>`;
    };
    const valueCell = (v: CmpValue | undefined) => {
      if (!v || v.s === 'p') return '<span class="prop-empty prop-empty--placeholder">not yet available</span>';
      if (v.s === 'n') return '<span class="prop-empty prop-empty--not_applicable">Not applicable</span>';
      const text = v.t ?? valueText(v.v ?? null, v.lo ?? null, v.hi ?? null, v.u ?? '', system) ?? '—';
      return (
        `<span class="prop-value">${esc(text)}</span>` +
        (v.s === 'e' ? '<span class="prop-flag">estimate</span>' : '') +
        cite(v.src) +
        (v.std ? `<span class="prop-standard">${esc(v.std)}</span>` : '') +
        (v.c ? `<span class="prop-conditions">${esc(v.c)}</span>` : '')
      );
    };
    const bool = (b: boolean | null) => (b === null ? '<span class="none">not yet determined</span>' : b ? 'Yes' : 'No');
    const chips = (xs: string[]) => (xs.length ? xs.map((x) => `<span class="chip">${esc(x)}</span>`).join(' ') : '<span class="none">—</span>');
    const text = (x: string | null) => (x ? esc(x) : '<span class="none">—</span>');

    const row = (label: string, cells: string[]) =>
      `<tr><th scope="row" class="cmp-label">${label}</th>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    const group = (title: string, rows: string[]) =>
      rows.length
        ? `<tbody><tr class="cmp-group"><th colspan="${sel.length + 1}" scope="rowgroup">${esc(title)}</th></tr>${rows.join('')}</tbody>`
        : '';
    const propRows = (metas: CmpPropMeta[]) =>
      metas.flatMap((m) => {
        const vals = sel.map(({ p }) => p.props[m.key]);
        if (!showEmpty && !vals.some(has)) return [];
        return [row(esc(m.label), vals.map(valueCell))];
      });

    const head = `<thead><tr><th class="cmp-label" scope="col" aria-label="Property"></th>${sel
      .map(
        ({ p, i }) =>
          `<th scope="col" class="cmp-col cmp-s${i + 1}"><a href="${p.path}">${esc(p.title)}</a><span class="cmp-col-meta">${p.year} · ${esc(p.eraName)}</span></th>`
      )
      .join('')}</tr></thead>`;

    const identity = [
      row(
        'Structure',
        sel.map(({ p }) =>
          p.structure
            ? `<div class="cmp-struct" data-struct-src="${p.structure}" aria-label="Repeat unit of ${esc(p.title)}"></div>`
            : '<span class="none">no single repeat unit</span>'
        )
      ),
      row('Type', sel.map(({ p }) => (p.facts.type === 'hub' ? 'polymer family (hub)' : `variant${p.facts.parent ? ` of ${esc(p.facts.parent)}` : ''}`))),
      row('Polymer class', sel.map(({ p }) => text(p.facts.polymer_class))),
      row('Chemical family', sel.map(({ p }) => chips(p.facts.family))),
      row('Backbone', sel.map(({ p }) => text(p.facts.backbone))),
      row('Polymerization', sel.map(({ p }) => chips(p.facts.mechanism))),
      row('Resin ID code', sel.map(({ p }) => text(p.facts.resin))),
    ];
    const byGroup = (g: string) => data.props.filter((m) => m.group === g);
    const gasKeys = [...new Set(sel.flatMap(({ p }) => Object.keys(p.gas)))];
    const gasRows = () => gasKeys.flatMap((k) => {
      const vals = sel.map(({ p }) => p.gas[k]);
      if (!showEmpty && !vals.some(has)) return [];
      const label = /^[A-Za-z]+\d/.test(k) ? k.replace(/\d/g, (d) => '₀₁₂₃₄₅₆₇₈₉'[+d]) : k;
      return [row(esc(label), vals.map(valueCell))];
    });
    const processing = () => [
      row('Methods', sel.map(({ p }) => chips(p.facts.methods))),
      row('Drying required', sel.map(({ p }) => bool(p.facts.drying))),
      ...propRows(byGroup('processing')),
    ];
    const environment = [
      row('Recyclable', sel.map(({ p }) => bool(p.facts.recyclable))),
      row('Biodegradable', sel.map(({ p }) => bool(p.facts.biodegradable))),
      row('Applications', sel.map(({ p }) => chips(p.facts.sectors))),
    ];

    // Built strictly top to bottom, so citation numbers run in reading order.
    const sections: [string, () => string[]][] = [
      ['Identity', () => identity],
      ['Physical', () => propRows(byGroup('physical'))],
      ['Thermal', () => propRows(byGroup('thermal'))],
      ['Mechanical', () => propRows(byGroup('mechanical'))],
      ['Resistance', () => propRows(byGroup('resistance'))],
      ['Gas permeability', gasRows],
      ['Processing', processing],
      ['Molecular weight', () => propRows([...byGroup('molecularWeight'), ...byGroup('morphology')])],
      ['Environment & use', () => environment],
      ['Toxicity & safety', () => propRows(byGroup('toxicity'))],
    ];
    const body = sections.map(([title, rows]) => group(title, rows())).join('');

    const sources = [...cites.entries()]
      .map(([key, n]) => {
        const b = data.bib[key];
        return `<li class="ref-item" id="cmp-src-${n}"><span class="ref-n">[${n}]</span><span class="ref-body">
          <span class="ref-title">${esc(b?.title ?? key)}</span>${b?.publisher ? `<span class="ref-pub">${esc(b.publisher)}</span>` : ''}
          ${b?.url ? `<a class="ref-url" href="${esc(b.url)}" rel="noopener">${esc(b.url)}</a>` : ''}</span></li>`;
      })
      .join('');

    stage.innerHTML = `
      <div class="cmp-toolbar">
        <button class="cmp-toggle${showEmpty ? ' is-on' : ''}" type="button" data-show-empty aria-pressed="${showEmpty}">
          <span class="cmp-toggle-box" aria-hidden="true"></span>Show properties with no data yet</button>
        <span class="cmp-note">Values in ${system === 'imperial' ? 'imperial' : 'SI'} units · switch in the reader's menu</span>
      </div>
      <div class="cmp-scroll"><table class="cmp-table cmp-n${sel.length}">${head}${body}</table></div>
      ${sources ? `<h3 class="tool-subhead u-caps">Sources</h3><ol class="ref-list cmp-sources">${sources}</ol>` : ''}`;
    loadStructures();
  }

  // Structure drawings are inlined, never <img>: they are drawn in
  // currentColor and only inherit the page's ink as part of the document.
  const svgCache = new Map<string, Promise<string>>();
  function loadStructures() {
    stage.querySelectorAll<HTMLElement>('[data-struct-src]').forEach((box) => {
      const src = box.dataset.structSrc!;
      if (!svgCache.has(src)) svgCache.set(src, fetch(src).then((r) => (r.ok ? r.text() : '')).catch(() => ''));
      svgCache.get(src)!.then((svg) => {
        if (svg.includes('<svg')) box.innerHTML = svg;
      });
    });
  }

  // --- the property checklist shared by the radar and the range view ----------
  function checklist(sel: { p: CmpPolymer; i: number }[]) {
    const groups = data.groups
      .map((g) => {
        const metas = chartable.filter((m) => m.group === g.id);
        if (!metas.length) return '';
        return `<div class="cmp-checks-group"><span class="cmp-checks-label u-caps">${esc(g.title)}</span>${metas
          .map((m) => {
            const dots = sel
              .map(({ p, i }) => `<i class="cmp-dot cmp-s${i + 1}${has(p.props[m.key]) ? '' : ' is-missing'}"></i>`)
              .join('');
            return `<button type="button" class="cmp-check${chartKeys.has(m.key) ? ' is-on' : ''}" data-chart-key="${m.key}" aria-pressed="${chartKeys.has(m.key)}">${esc(m.label)}<span class="cmp-dots" aria-hidden="true">${dots}</span></button>`;
          })
          .join('')}</div>`;
      })
      .join('');
    const names = chartable.filter((m) => chartKeys.has(m.key)).map((m) => esc(m.label));
    return `<details class="cmp-checks" data-checks${checksOpen ? ' open' : ''}><summary><span class="u-caps">Properties to chart</span>
      <span class="cmp-count">${names.length ? names.join(' · ') : 'none chosen'}</span><span class="cmp-count-edit">${checksOpen ? 'done' : 'change'}</span></summary>
      <div class="cmp-checks-body">${groups}</div>
      <p class="cmp-note">A filled dot means that polymer has a value for the property; a hollow one means the Atlas has none yet.</p></details>`;
  }
  const legend = (sel: { p: CmpPolymer; i: number }[]) =>
    `<div class="cmp-legend">${sel
      .map(({ p, i }) => `<span class="cmp-legend-item"><i class="cmp-dot cmp-s${i + 1}"></i>${esc(p.title)}</span>`)
      .join('')}</div>`;

  // --- radar ------------------------------------------------------------------
  function renderRadar(sel: { p: CmpPolymer; i: number }[]) {
    const metas = chartable.filter((m) => chartKeys.has(m.key));
    stage.innerHTML = `${checklist(sel)}${legend(sel)}<div class="cmp-chart" data-chart></div>`;
    const host = stage.querySelector<HTMLElement>('[data-chart]')!;
    if (metas.length < 3) {
      host.innerHTML = '<p class="cmp-empty">Choose at least three properties to draw the radar.</p>';
      return;
    }
    const W = 640;
    const H = 560;
    const cx = W / 2;
    const cy = H / 2 + 6;
    const R = 188;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cmp-svg cmp-radar', role: 'img', 'aria-label': 'Radar of the chosen properties' });
    const axes = metas.map((m) => axisFor(m, system));
    const ang = (k: number) => (-90 + (360 / axes.length) * k) * (Math.PI / 180);
    const at = (k: number, r: number): [number, number] => [cx + r * Math.cos(ang(k)), cy + r * Math.sin(ang(k))];

    for (const f of [0.25, 0.5, 0.75, 1]) {
      svg.append(el('polygon', { class: f === 1 ? 'cmp-ring cmp-ring--outer' : 'cmp-ring', points: axes.map((_, k) => at(k, R * f).join(',')).join(' ') }));
    }
    axes.forEach((a, k) => {
      const [x, y] = at(k, R);
      svg.append(el('line', { class: 'cmp-spoke', x1: cx, y1: cy, x2: x, y2: y }));
      const [lx, ly] = at(k, R + 22);
      const c = Math.cos(ang(k));
      const anchor = Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end';
      const label = el('text', { x: lx, y: ly, class: 'cmp-axis-label', 'text-anchor': anchor, 'dominant-baseline': 'middle' });
      label.append(el('tspan', { x: lx, dy: '-0.35em' }, a.meta.label));
      label.append(
        el('tspan', { x: lx, dy: '1.25em', class: 'cmp-axis-range' }, `${fmt(a.lo)}–${fmt(a.hi)} ${a.unit}${a.log ? ' · log' : ''}`.trim())
      );
      svg.append(label);
    });

    const gaps: string[] = [];
    for (const { p, i } of sel) {
      const pts = axes.map((a) => {
        const v = p.props[a.meta.key];
        if (!has(v)) return null;
        const pv = point(v);
        return pv == null ? null : { v, r: R * clamp01(a.t(a.conv(pv))) };
      });
      const cls = `cmp-s${i + 1}`;
      const g = el('g', { class: `cmp-series ${cls}` });
      const coords = pts.map((pt, k) => (pt ? at(k, pt.r) : null));
      if (coords.every(Boolean)) {
        g.append(el('polygon', { class: 'cmp-area', points: coords.map((c) => c!.join(',')).join(' ') }));
      } else {
        coords.forEach((c, k) => {
          const d = coords[(k + 1) % coords.length];
          if (c && d) g.append(el('line', { class: 'cmp-edge', x1: c[0], y1: c[1], x2: d[0], y2: d[1] }));
        });
        const missing = axes.filter((_, k) => !pts[k]).map((a) => a.meta.label);
        gaps.push(`${esc(p.short)} has no value yet for ${missing.map(esc).join(', ')}`);
      }
      pts.forEach((pt, k) => {
        if (!pt) return;
        const a = axes[k];
        if (pt.v.lo != null && pt.v.hi != null) {
          const [x1, y1] = at(k, R * clamp01(a.t(a.conv(pt.v.lo))));
          const [x2, y2] = at(k, R * clamp01(a.t(a.conv(pt.v.hi))));
          g.append(el('line', { class: 'cmp-whisker', x1, y1, x2, y2 }));
        }
        const [x, y] = coords[k]!;
        const hit = el('g', { 'data-tipx': tipFor(p, a.meta, pt.v) });
        hit.append(el('circle', { class: 'cmp-hit', cx: x, cy: y, r: 11 }));
        hit.append(el('circle', { class: 'cmp-point', cx: x, cy: y, r: 4.5 }));
        g.append(hit);
      });
      svg.append(g);
    }
    host.append(svg);
    if (gaps.length) host.insertAdjacentHTML('beforeend', `<p class="cmp-note cmp-gaps">${gaps.join('. ')}.</p>`);
  }

  // --- range bars ---------------------------------------------------------------
  function renderRange(sel: { p: CmpPolymer; i: number }[]) {
    const metas = chartable.filter((m) => chartKeys.has(m.key));
    const rows = metas
      .map((m) => {
        const a = axisFor(m, system);
        const pos = (si: number) => `${(clamp01(a.t(a.conv(si))) * 100).toFixed(2)}%`;
        const atlas = data.polymers
          .map((p) => ({ p, v: p.props[m.key] }))
          .filter((x) => has(x.v) && point(x.v) != null)
          .map(({ p, v }) => `<i class="cmp-rug" style="left:${pos(point(v)!)}" title="${esc(p.short)}"></i>`)
          .join('');
        const marks = sel
          .map(({ p, i }) => {
            const v = p.props[m.key];
            if (!has(v) || point(v) == null) return '';
            const bar =
              v.lo != null && v.hi != null
                ? `<i class="cmp-span cmp-s${i + 1}" style="left:${pos(Math.min(v.lo, v.hi))};width:calc(${pos(Math.max(v.lo, v.hi))} - ${pos(Math.min(v.lo, v.hi))})"></i>`
                : '';
            return `${bar}<i class="cmp-mark cmp-s${i + 1}" style="left:${pos(point(v)!)}" data-tipx="${esc(tipFor(p, m, v))}"></i>`;
          })
          .join('');
        const missing = sel.filter(({ p }) => !has(p.props[m.key])).map(({ p }) => esc(p.short));
        return `<div class="cmp-range-row">
            <div class="cmp-range-label">${esc(m.label)}<span class="cmp-range-unit">${esc(a.unit)}${a.log ? ' · log scale' : ''}</span></div>
            <div class="cmp-range-track"><div class="cmp-range-line">${atlas}${marks}</div>
              <div class="cmp-range-ends"><span>${fmt(a.lo)}</span>${missing.length ? `<span class="cmp-range-missing">no value yet: ${missing.join(', ')}</span>` : ''}<span>${fmt(a.hi)}</span></div></div>
          </div>`;
      })
      .join('');
    stage.innerHTML = `${checklist(sel)}${legend(sel)}
      <div class="cmp-range">${rows || '<p class="cmp-empty">Choose properties above to place them on the Atlas scale.</p>'}</div>
      <p class="cmp-note">Each line runs from the lowest value in the whole Atlas to the highest. The fine grey ticks are every other polymer that has a value; a coloured bar is a range its source gives.</p>`;
  }

  // --- property map ---------------------------------------------------------------
  function renderMap(sel: { p: CmpPolymer; i: number }[]) {
    const options = (current: string) =>
      data.groups
        .map((g) => {
          const ms = chartable.filter((m) => m.group === g.id);
          return ms.length
            ? `<optgroup label="${esc(g.title)}">${ms.map((m) => `<option value="${m.key}"${m.key === current ? ' selected' : ''}>${esc(m.label)}</option>`).join('')}</optgroup>`
            : '';
        })
        .join('');
    stage.innerHTML = `<div class="cmp-map-controls">
        <label><span class="u-caps">Across</span><select class="cmp-select" data-map-x>${options(mapX)}</select></label>
        <label><span class="u-caps">Up</span><select class="cmp-select" data-map-y>${options(mapY)}</select></label>
      </div>${sel.length ? legend(sel) : ''}<div class="cmp-chart" data-chart></div>`;
    const host = stage.querySelector<HTMLElement>('[data-chart]')!;
    const ax = axisFor(metaByKey.get(mapX)!, system);
    const ay = axisFor(metaByKey.get(mapY)!, system);
    const W = 720;
    const H = 470;
    const m = { l: 70, r: 26, t: 18, b: 56 };
    const X = (v: number) => m.l + clamp01(ax.t(v)) * (W - m.l - m.r);
    const Y = (v: number) => H - m.b - clamp01(ay.t(v)) * (H - m.t - m.b);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'cmp-svg cmp-map', role: 'img', 'aria-label': `${ay.meta.label} against ${ax.meta.label}` });

    for (const t of ax.ticks) {
      svg.append(el('line', { class: 'cmp-grid', x1: X(t), x2: X(t), y1: m.t, y2: H - m.b }));
      svg.append(el('text', { class: 'cmp-tick', x: X(t), y: H - m.b + 18, 'text-anchor': 'middle' }, ax.label(t)));
    }
    for (const t of ay.ticks) {
      svg.append(el('line', { class: 'cmp-grid', x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t) }));
      svg.append(el('text', { class: 'cmp-tick', x: m.l - 8, y: Y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, ay.label(t)));
    }
    svg.append(el('line', { class: 'cmp-axis', x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b }));
    svg.append(el('line', { class: 'cmp-axis', x1: m.l, x2: m.l, y1: m.t, y2: H - m.b }));
    svg.append(
      el('text', { class: 'cmp-axis-title', x: (m.l + W - m.r) / 2, y: H - 12, 'text-anchor': 'middle' }, `${ax.meta.label} (${ax.unit || 'no unit'})${ax.log ? ' · log scale' : ''}`)
    );
    svg.append(
      el(
        'text',
        { class: 'cmp-axis-title', x: 16, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', transform: `rotate(-90 16 ${(m.t + H - m.b) / 2})` },
        `${ay.meta.label} (${ay.unit || 'no unit'})${ay.log ? ' · log scale' : ''}`
      )
    );

    const selected = new Map(sel.map(({ p, i }) => [p.id, i]));
    const free = slots.some((s) => !s);
    let plotted = 0;
    const back = el('g', { class: 'cmp-cloud' });
    const front = el('g', {});
    for (const p of data.polymers) {
      const vx = p.props[mapX];
      const vy = p.props[mapY];
      if (!has(vx) || !has(vy)) continue;
      const px = point(vx);
      const py = point(vy);
      if (px == null || py == null) continue;
      plotted++;
      const x = X(ax.conv(px));
      const y = Y(ay.conv(py));
      const tipText =
        `<b>${esc(p.title)}</b><br>${esc(ax.meta.label)}: ${esc(valueText(vx.v ?? null, vx.lo ?? null, vx.hi ?? null, vx.u ?? '', system) ?? '')}` +
        `<br>${esc(ay.meta.label)}: ${esc(valueText(vy.v ?? null, vy.lo ?? null, vy.hi ?? null, vy.u ?? '', system) ?? '')}`;
      const slot = selected.get(p.id);
      if (slot === undefined) {
        const g = el('g', {
          class: free ? 'cmp-cloud-pt is-addable' : 'cmp-cloud-pt',
          'data-tipx': tipText + (free ? '<br><i>Click to add to the comparison</i>' : ''),
          ...(free ? { 'data-add': p.id } : {}),
        });
        g.append(el('circle', { class: 'cmp-hit', cx: x, cy: y, r: 8 }));
        g.append(el('circle', { class: 'cmp-cloud-dot', cx: x, cy: y, r: 3.5 }));
        back.append(g);
      } else {
        const g = el('g', { class: `cmp-series cmp-s${slot + 1}`, 'data-tipx': tipText });
        const x0 = vx.lo != null ? X(ax.conv(Math.min(vx.lo, vx.hi!))) : x;
        const x1 = vx.hi != null ? X(ax.conv(Math.max(vx.lo!, vx.hi))) : x;
        const y0 = vy.hi != null ? Y(ay.conv(Math.max(vy.lo!, vy.hi))) : y;
        const y1 = vy.lo != null ? Y(ay.conv(Math.min(vy.lo, vy.hi!))) : y;
        if (x1 - x0 > 1 || y1 - y0 > 1) {
          g.append(el('rect', { class: 'cmp-bubble', x: Math.min(x0, x1) - 5, y: Math.min(y0, y1) - 5, width: Math.abs(x1 - x0) + 10, height: Math.abs(y1 - y0) + 10, rx: 8 }));
        }
        g.append(el('circle', { class: 'cmp-hit', cx: x, cy: y, r: 11 }));
        g.append(el('circle', { class: 'cmp-point cmp-point--big', cx: x, cy: y, r: 6.5 }));
        const right = x < W - 170;
        g.append(el('text', { class: 'cmp-point-label', x: right ? x + 11 : x - 11, y: y - 9, 'text-anchor': right ? 'start' : 'end' }, p.short));
        front.append(g);
      }
    }
    svg.append(back, front);
    host.append(svg);
    const missing = sel.filter(({ p }) => !has(p.props[mapX]) || !has(p.props[mapY])).map(({ p }) => esc(p.short));
    host.insertAdjacentHTML(
      'beforeend',
      `<p class="cmp-note">${plotted} of ${data.polymers.length} polymers have both values and are plotted.${
        missing.length ? ` Not on the map, for want of a value: ${missing.join(', ')}.` : ''
      }${free ? ' Click any grey point to add it to the comparison.' : ''}</p>`
    );
  }

  // Units switched in the reader's menu: redraw in the new system.
  const onUnits = () => {
    system = storedUnits();
    render();
  };
  document.addEventListener(UNITS_CHANGE_EVENT, onUnits);
  document.addEventListener('astro:before-swap', () => document.removeEventListener(UNITS_CHANGE_EVENT, onUnits), {
    once: true,
  });

  if (view !== 'table') {
    root.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.view === view);
      b.setAttribute('aria-selected', String(b.dataset.view === view));
    });
  }
  renderSlots();
  render();
}
