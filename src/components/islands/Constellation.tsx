// The Constellation:
// an infinite-canvas, node-based timeline chart of polymer history.
//   • x = real dates (px-per-year scale), y = chemical-family strands,
//     the 7 eras as labeled bands — an encyclopedia plate, not a toy.
//   • Semantic zoom: far = the full sweep of eras; mid = family strands and
//     abbreviations; near = full titles/years. Entries are REAL <a> links —
//     pointer capture starts only after a drag threshold, so plain clicks
//     reach the anchor and navigate natively.
//   • Zoom floor = the exact fit of the chart (no drifting into empty
//     space); content centers on whichever axis it doesn't fill.
//   • Year ruler (top) with edge/major/minor ticks and family lane labels
//     (left) are screen-fixed map furniture, collision-culled every frame.
//   • Era + family filters in custom animated dropdowns: picking one dims
//     non-matches and flies the camera to fit the selection.
//   • No idle motion. No WebGL, no physics — deterministic positions,
//     HTML/CSS transforms only. Data = the same /catalogue.json as the
//     catalogue (one index, no duplicate loading logic).
import { useEffect, useMemo, useRef, useState } from 'react';

// ------------------------------------------------------------------- data --
export interface EraMeta {
  id: string;
  name: string;
  year_start: number;
  year_end: number;
}

interface CatalogueRecord {
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
}

// -------------------------------------------------------- world geometry --
const PX_PER_YEAR = 30;
const YEAR_ORIGIN = 1826; // x = 0; only a coordinate origin, not a bound
const LANE_PAD_TOP = 34;
const ROW_H = 48;
const LANE_PAD_BOTTOM = 14;
const ROW_MIN_GAP = 170; // world px before a lane opens a second sub-row
const MAX_K = 3;
const WORLD_TOP = 240; // room for era spine titles above the first lane
const RULER_H = 30;

const xOfYear = (year: number) => (year - YEAR_ORIGIN) * PX_PER_YEAR;

interface ChartNode extends CatalogueRecord {
  x: number;
  y: number;
}

interface Lane {
  family: string;
  label: string;
  top: number;
  height: number;
  eraIndex: number;
  nodes: ChartNode[];
}

interface Tick {
  year: number;
  kind: 'edge' | 'major' | 'minor';
}

interface Layout {
  lanes: Lane[];
  nodes: ChartNode[];
  ticks: Tick[];
  worldH: number;
  /** the fit/pan bounds: the chart itself plus a small breathing edge */
  fitX0: number;
  fitX1: number;
}

const laneFamily = (r: CatalogueRecord) =>
  r.type === 'concept' ? 'concepts & theory' : (r.chemical_family[0] ?? 'other materials');

function buildLayout(records: CatalogueRecord[]): Layout {
  const groups = new Map<string, CatalogueRecord[]>();
  for (const r of records) {
    const fam = laneFamily(r);
    const g = groups.get(fam);
    if (g) g.push(r);
    else groups.set(fam, [r]);
  }
  const ordered = [...groups.entries()].sort(
    (a, b) =>
      Math.min(...a[1].map((r) => r.year)) - Math.min(...b[1].map((r) => r.year)) ||
      a[0].localeCompare(b[0])
  );
  let top = WORLD_TOP;
  const lanes: Lane[] = [];
  const nodes: ChartNode[] = [];
  for (const [family, members] of ordered) {
    members.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
    const rowLastX: number[] = [];
    const placed = members.map((m) => {
      const x = xOfYear(m.year);
      let row = rowLastX.findIndex((lx) => x - lx >= ROW_MIN_GAP);
      if (row === -1) {
        row = rowLastX.length;
        rowLastX.push(x);
      } else {
        rowLastX[row] = x;
      }
      return { m, x, row };
    });
    const height = LANE_PAD_TOP + rowLastX.length * ROW_H + LANE_PAD_BOTTOM;
    const laneNodes = placed.map(({ m, x, row }) => ({
      ...m,
      x,
      y: top + LANE_PAD_TOP + row * ROW_H,
    }));
    nodes.push(...laneNodes);
    lanes.push({
      family,
      label: family.replace(/-/g, ' '),
      top,
      height,
      eraIndex: laneNodes[0].era.index,
      nodes: laneNodes,
    });
    top += height;
  }

  // Ruler ticks: the data's exact first/last years as emphasized edge
  // ticks, 20-year majors, 10-year minors between them.
  const years = records.map((r) => r.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const ticks: Tick[] = [{ year: minYear, kind: 'edge' }];
  for (let y = Math.ceil(minYear / 10) * 10; y <= maxYear; y += 10) {
    if (Math.abs(y - minYear) < 5 || Math.abs(y - maxYear) < 5) continue;
    ticks.push({ year: y, kind: y % 20 === 0 ? 'major' : 'minor' });
  }
  ticks.push({ year: maxYear, kind: 'edge' });

  return {
    lanes,
    nodes,
    ticks,
    worldH: top + 60,
    fitX0: xOfYear(minYear) - 130,
    fitX1: xOfYear(maxYear) + 340,
  };
}

// ----------------------------------------------------------------- camera --
interface Camera {
  x: number;
  y: number;
  k: number;
}

interface Fit {
  k: number;
  cam: Camera;
  rect: { x0: number; y0: number; x1: number; y1: number };
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const zoomBand = (k: number) => (k < 0.34 ? 'zoom-far' : k < 0.9 ? 'zoom-mid' : 'zoom-near');

const shortEra = (name: string) => name.replace(/\s*\(.*$/, '');

// -------------------------------------------------------------- dropdown --
interface Option {
  value: string;
  label: string;
  detail: string;
  eraIndex: number | null;
}

function FilterSelect({
  placeholder,
  options,
  value,
  onChange,
}: {
  placeholder: string;
  options: Option[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const current = options.find((o) => o.value === value) ?? null;

  return (
    <div className={`chart-select${open ? ' is-open' : ''}`} ref={rootRef}>
      <button type="button" className="chart-select-trigger" onClick={() => setOpen(!open)}>
        <span key={current?.value ?? '∅'} className="chart-select-label">
          {current ? (
            <>
              {current.eraIndex !== null && (
                <span className={`chart-swatch era-c-${current.eraIndex}`} aria-hidden="true" />
              )}
              {current.label}
            </>
          ) : (
            placeholder
          )}
        </span>
        <span className="chart-select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <div className="chart-menu" role="listbox">
        <button
          type="button"
          className={`chart-menu-item${value === null ? ' is-selected' : ''}`}
          style={{ transitionDelay: open ? '30ms' : '0ms' }}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          <span className="chart-menu-label">{placeholder}</span>
          <span className="chart-menu-detail">show everything</span>
        </button>
        {options.map((o, i) => (
          <button
            key={o.value}
            type="button"
            className={`chart-menu-item${o.value === value ? ' is-selected' : ''}`}
            style={{ transitionDelay: open ? `${50 + i * 16}ms` : '0ms' }}
            onClick={() => {
              onChange(o.value);
              setOpen(false);
            }}
          >
            {o.eraIndex !== null && (
              <span className={`chart-swatch era-c-${o.eraIndex}`} aria-hidden="true" />
            )}
            <span className="chart-menu-label">{o.label}</span>
            <span className="chart-menu-detail">{o.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- component --
export default function Constellation({
  catalogueUrl,
  eras,
}: {
  catalogueUrl: string;
  eras: EraMeta[];
}) {
  const [records, setRecords] = useState<CatalogueRecord[] | null>(null);
  const [error, setError] = useState(false);
  const [eraFilter, setEraFilter] = useState<string | null>(null);
  const [familyFilter, setFamilyFilter] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const laneLabelsRef = useRef<HTMLDivElement>(null);
  const cam = useRef<Camera>({ x: 0, y: 0, k: 0.2 });
  const fit = useRef<Fit | null>(null);
  const tweenId = useRef(0);
  const dragDist = useRef(0);

  useEffect(() => {
    fetch(catalogueUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setRecords)
      .catch(() => setError(true));
  }, [catalogueUrl]);

  const layout = useMemo(() => (records ? buildLayout(records) : null), [records]);

  // ------------------------------------------------- imperative camera IO --
  // Pan/zoom writes transforms straight to the DOM (no React re-render per
  // frame); React state is only for filters and dropdowns.

  /** Clamp a camera to the zoom floor (= exact fit) and the chart bounds;
   *  axes the content doesn't fill are centered, so full zoom-out is the
   *  whole chart, centered — never adrift in empty space. */
  const clampCam = (c: Camera): Camera => {
    const vp = viewportRef.current;
    const f = fit.current;
    if (!vp || !f) return c;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    c.k = Math.min(Math.max(c.k, f.k), MAX_K);
    const { x0, y0, x1, y1 } = f.rect;
    const w = x1 - x0;
    const h = y1 - y0;
    const vwW = vw / c.k;
    const vwH = vh / c.k;
    c.x = w <= vwW ? x0 - (vwW - w) / 2 : Math.min(Math.max(c.x, x0), x1 - vwW);
    c.y = h <= vwH ? y0 - (vwH - h) / 2 : Math.min(Math.max(c.y, y0), y1 - vwH);
    return c;
  };

  const computeFit = () => {
    const vp = viewportRef.current;
    if (!vp || !layout) return;
    const rect = { x0: layout.fitX0, y0: 0, x1: layout.fitX1, y1: layout.worldH };
    const k = Math.min(
      Math.max(
        Math.min(vp.clientWidth / (rect.x1 - rect.x0), vp.clientHeight / (rect.y1 - rect.y0)),
        0.02
      ),
      MAX_K
    );
    fit.current = { k, rect, cam: { x: 0, y: 0, k } };
    fit.current.cam = clampCam({ x: rect.x0, y: rect.y0, k });
  };

  const apply = () => {
    const vp = viewportRef.current;
    const world = worldRef.current;
    if (!vp || !world) return;
    const { x, y, k } = cam.current;
    world.style.transform = `translate(${-x * k}px, ${-y * k}px) scale(${k})`;
    const band = zoomBand(k);
    if (!vp.classList.contains(band)) {
      vp.classList.remove('zoom-far', 'zoom-mid', 'zoom-near');
      vp.classList.add(band);
    }
    // Year ruler: position every tick, cull labels that would collide.
    if (rulerRef.current) {
      let lastLabelRight = -Infinity;
      for (const tick of [...rulerRef.current.children] as HTMLElement[]) {
        const sx = Number(tick.dataset.x) * k - x * k;
        tick.style.transform = `translateX(${sx}px)`;
        const isEdge = tick.classList.contains('is-edge');
        const show = isEdge || sx - lastLabelRight >= 12;
        tick.classList.toggle('is-crowded', !show);
        if (show) lastLabelRight = sx + (isEdge ? 48 : 40);
      }
    }
    // Family lane labels: always on, collision-culled top-to-bottom.
    if (laneLabelsRef.current) {
      const vh = vp.clientHeight;
      let lastY = -Infinity;
      for (const label of [...laneLabelsRef.current.children] as HTMLElement[]) {
        const sy = Number(label.dataset.y) * k - y * k;
        label.style.transform = `translateY(${sy}px)`;
        const show = sy > RULER_H + 6 && sy < vh - 12 && sy - lastY >= 17;
        label.classList.toggle('is-hidden', !show);
        if (show) lastY = sy;
      }
    }
  };

  const flyTo = (target: Camera, ms = 850) => {
    const id = ++tweenId.current;
    clampCam(target);
    const from = { ...cam.current };
    if (document.hidden || ms <= 0) {
      cam.current = target;
      apply();
      return;
    }
    const t0 = performance.now();
    const step = (now: number) => {
      if (tweenId.current !== id) return;
      const p = easeInOutCubic(Math.min(1, (now - t0) / ms));
      cam.current = {
        x: from.x + (target.x - from.x) * p,
        y: from.y + (target.y - from.y) * p,
        k: from.k + (target.k - from.k) * p,
      };
      apply();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const fitAll = (animate: boolean) => {
    if (!fit.current) return;
    const target = { ...fit.current.cam };
    if (animate) flyTo(target);
    else {
      cam.current = target;
      apply();
    }
  };

  // Initial fit once the layout exists; refit floor on viewport resize.
  useEffect(() => {
    if (!layout) return;
    computeFit();
    fitAll(false);
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      computeFit();
      clampCam(cam.current);
      apply();
    });
    ro.observe(vp);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // ------------------------------------------------------- pan/zoom input --
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !layout) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDist = 0;

    // IMPORTANT: capture is NOT taken on pointerdown — capturing there
    // retargets the eventual `click` to the viewport and the entry links
    // never fire. Capture starts only once a real drag is under way.
    const capture = (pointerId: number) => {
      try {
        if (!vp.hasPointerCapture(pointerId)) vp.setPointerCapture(pointerId);
      } catch {
        /* stale/synthetic pointer — capture is an optimisation, never fatal */
      }
    };

    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest('.chart-select')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        for (const id of pointers.keys()) capture(id);
      }
      dragDist.current = 0;
      tweenId.current++; // cancel any flight
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        dragDist.current += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
        if (dragDist.current > 4) capture(e.pointerId);
        cam.current.x -= (cur.x - prev.x) / cam.current.k;
        cam.current.y -= (cur.y - prev.y) / cam.current.k;
        clampCam(cam.current);
        apply();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinchDist);
        pinchDist = d;
        dragDist.current += 10;
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinchDist = 0;
    };

    const zoomAt = (sx: number, sy: number, factor: number) => {
      const rect = vp.getBoundingClientRect();
      const px = sx - rect.left;
      const py = sy - rect.top;
      const c = cam.current;
      const wx = c.x + px / c.k;
      const wy = c.y + py / c.k;
      c.k = Math.min(Math.max(c.k * factor, fit.current?.k ?? 0.02), MAX_K);
      c.x = wx - px / c.k;
      c.y = wy - py / c.k;
      clampCam(c);
      apply();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      tweenId.current++;
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
    };

    vp.addEventListener('pointerdown', onDown);
    vp.addEventListener('pointermove', onMove);
    vp.addEventListener('pointerup', onUp);
    vp.addEventListener('pointercancel', onUp);
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      vp.removeEventListener('pointerdown', onDown);
      vp.removeEventListener('pointermove', onMove);
      vp.removeEventListener('pointerup', onUp);
      vp.removeEventListener('pointercancel', onUp);
      vp.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // ---------------------------------------------------------- filter fly --
  const matches = (n: ChartNode) =>
    (eraFilter === null || n.era.index === Number(eraFilter)) &&
    (familyFilter === null ||
      n.chemical_family.includes(familyFilter) ||
      laneFamily(n) === familyFilter);

  useEffect(() => {
    if (!layout || !viewportRef.current) return;
    if (eraFilter === null && familyFilter === null) {
      fitAll(true);
      return;
    }
    const hit = layout.nodes.filter(matches);
    if (!hit.length) return;
    const vp = viewportRef.current;
    const x0 = Math.min(...hit.map((n) => n.x)) - 220;
    const x1 = Math.max(...hit.map((n) => n.x)) + 220;
    const y0 = Math.min(...hit.map((n) => n.y)) - 160;
    const y1 = Math.max(...hit.map((n) => n.y)) + 160;
    const k = Math.min(
      Math.max(
        Math.min(vp.clientWidth / (x1 - x0), vp.clientHeight / (y1 - y0)) * 0.92,
        fit.current?.k ?? 0.02
      ),
      MAX_K
    );
    flyTo({
      k,
      x: (x0 + x1) / 2 - vp.clientWidth / k / 2,
      y: (y0 + y1) / 2 - vp.clientHeight / k / 2,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eraFilter, familyFilter, layout]);

  // ------------------------------------------------------------- options --
  const eraOptions: Option[] = useMemo(
    () =>
      eras.map((e, i) => ({
        value: String(i),
        label: shortEra(e.name),
        detail: `${e.year_start}–${e.year_end} · ${records?.filter((r) => r.era.index === i).length ?? 0} entries`,
        eraIndex: i,
      })),
    [eras, records]
  );

  const familyOptions: Option[] = useMemo(
    () =>
      (layout?.lanes ?? []).map((l) => ({
        value: l.family,
        label: l.label,
        detail: `${l.nodes.length} ${l.nodes.length === 1 ? 'entry' : 'entries'} · from ${l.nodes[0].year}`,
        eraIndex: l.eraIndex,
      })),
    [layout]
  );

  // ---------------------------------------------------------------- render --
  if (error)
    return <p className="const-status">Could not load the catalogue index. Try reloading.</p>;
  if (!layout) return <p className="const-status">Drawing the chart…</p>;

  const filtered = eraFilter !== null || familyFilter !== null;

  return (
    <div className="chart-wrap">
      <div className="chart-toolbar">
        <FilterSelect
          placeholder="Every era"
          options={eraOptions}
          value={eraFilter}
          onChange={setEraFilter}
        />
        <FilterSelect
          placeholder="Every family"
          options={familyOptions}
          value={familyFilter}
          onChange={setFamilyFilter}
        />
        {filtered && (
          <button
            type="button"
            className="chart-reset"
            onClick={() => {
              setEraFilter(null);
              setFamilyFilter(null);
            }}
          >
            Clear
          </button>
        )}
        <span className="chart-hint">
          drag to pan · scroll to zoom · zoom in to reveal entries · click one to open it
        </span>
        <div className="chart-zoom">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => {
              const vp = viewportRef.current!;
              const c = cam.current;
              const k = Math.max(c.k / 1.5, fit.current?.k ?? 0.02);
              flyTo(
                {
                  k,
                  x: c.x + (vp.clientWidth / c.k - vp.clientWidth / k) / 2,
                  y: c.y + (vp.clientHeight / c.k - vp.clientHeight / k) / 2,
                },
                350
              );
            }}
          >
            −
          </button>
          <button type="button" aria-label="Fit the whole chart" onClick={() => fitAll(true)}>
            ⤢
          </button>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => {
              const vp = viewportRef.current!;
              const c = cam.current;
              const k = Math.min(c.k * 1.5, MAX_K);
              flyTo(
                {
                  k,
                  x: c.x + (vp.clientWidth / c.k - vp.clientWidth / k) / 2,
                  y: c.y + (vp.clientHeight / c.k - vp.clientHeight / k) / 2,
                },
                350
              );
            }}
          >
            +
          </button>
        </div>
      </div>

      <div
        className="chart-viewport zoom-far"
        ref={viewportRef}
        onClickCapture={(e) => {
          if (dragDist.current > 5) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div className="chart-world" ref={worldRef}>
          {eras.map((era, i) => (
            <div
              key={era.id}
              className={`chart-era era-c-${i}`}
              style={{
                left: xOfYear(era.year_start),
                width: xOfYear(era.year_end + 1) - xOfYear(era.year_start),
                height: layout.worldH,
              }}
            >
              <span className="chart-era-title">{shortEra(era.name)}</span>
              <span className="chart-era-years">
                {era.year_start}–{era.year_end}
              </span>
            </div>
          ))}

          <svg
            className="chart-strands"
            width={layout.fitX1}
            height={layout.worldH}
            viewBox={`0 0 ${layout.fitX1} ${layout.worldH}`}
            aria-hidden="true"
          >
            {layout.lanes
              .filter((l) => l.nodes.length > 1)
              .map((l) => (
                <polyline
                  key={l.family}
                  className={`chart-strand era-c-${l.eraIndex}`}
                  points={l.nodes.map((n) => `${n.x},${n.y}`).join(' ')}
                />
              ))}
          </svg>

          {layout.nodes.map((n) => (
            <a
              key={n.id}
              href={n.path}
              className={[
                'chart-node',
                `era-c-${n.era.index}`,
                n.type === 'concept'
                  ? 'is-concept'
                  : n.type === 'variant'
                    ? 'is-variant'
                    : 'is-hub',
                filtered && !matches(n) ? 'is-dim' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: n.x, top: n.y }}
              draggable={false}
            >
              <span className="chart-dot" aria-hidden="true" />
              <span className="chart-text">
                <span className="chart-abbr">{n.abbreviation[0] ?? ''}</span>
                <span className="chart-title">
                  {n.title}
                  <span className="chart-year"> {n.year}</span>
                </span>
              </span>
            </a>
          ))}
        </div>

        <div className="chart-ruler" ref={rulerRef} aria-hidden="true">
          {layout.ticks.map((t) => (
            <span key={t.year} className={`chart-tick is-${t.kind}`} data-x={xOfYear(t.year)}>
              <span className="tick-label">{t.year}</span>
            </span>
          ))}
        </div>

        <div className="chart-lanelabels" ref={laneLabelsRef} aria-hidden="true">
          {layout.lanes.map((l) => (
            <span
              key={l.family}
              className={`chart-lanelabel era-c-${l.eraIndex}`}
              data-y={l.top + LANE_PAD_TOP}
            >
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
