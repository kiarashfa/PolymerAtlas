// Client for the two chemistry services behind the tool pages and the
// in-narrative molecule popup. Pure and client-safe: no astro:content, no
// DOM, so it can be imported from a component script or unit-tested.
//
// Both services are external and free-tier. Nothing in the reference content
// depends on them — every caller here must handle failure as a normal
// outcome, not an exception, which is why every function returns a result
// object instead of throwing.

export const CHEM_API = 'https://kiarashfa.pythonanywhere.com';
export const PREDICT_API = 'https://polymatai.pythonanywhere.com';

/** The browser gives up before the reader does. */
const TIMEOUT_MS = 20_000;

export interface ApiError {
  code: 'bad_request' | 'bad_smiles' | 'not_found' | 'upstream_unavailable' | 'network' | 'timeout';
  message: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * One molecule, as the chemistry service describes it.
 *
 * `descriptors` is deliberately an open record rather than a fixed shape:
 * RDKit can compute far more than the ten values the service returns today,
 * and the intent is to be able to add more later. A new key added server-side
 * appears in the UI on its own, with a humanised label; giving it a proper
 * label, a unit and a tooltip is one line in lib/descriptors.ts. Never
 * narrow this to an interface with named fields — that would make every
 * future addition a site change.
 */
export interface MoleculeResult {
  input: string;
  input_type: 'name' | 'smiles';
  resolved_from: string | null;
  cached: boolean;
  smiles: string;
  formula: string;
  molecular_weight: number;
  exact_mass: number;
  inchi: string | null;
  inchikey: string | null;
  /** > 0 when the structure is a fragment (a repeat unit's open valences). */
  dummy_atoms: number;
  descriptors: Record<string, number>;
  /** Inline-ready: transparent, drawn in currentColor, no fixed size. */
  svg: string;
}

export interface ResolveResult {
  query: string;
  smiles: string;
  source: string;
  cached: boolean;
}

export interface HealthResult {
  ok: boolean;
  rdkit_version: string;
  resolvers: string[];
}

// Repeat lookups are common — a reader opening the same popup twice, or
// re-running a prediction after editing the other field. Keyed by request,
// lives for the session, and never persisted (a stale cache across days
// would hide a service that has started returning better data).
const moleculeCache = new Map<string, MoleculeResult>();

function networkError(err: unknown): ApiError {
  const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
  return timedOut
    ? { code: 'timeout', message: 'The chemistry service did not answer in time.' }
    : { code: 'network', message: 'The chemistry service could not be reached.' };
}

async function getJson<T>(url: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: { code: 'network', message: 'The service returned an unreadable reply.' } };
  }

  if (!response.ok) {
    const error = (body as { error?: ApiError }).error;
    return {
      ok: false,
      error: error ?? { code: 'network', message: `The service replied ${response.status}.` },
    };
  }
  return { ok: true, data: body as T };
}

export async function health(): Promise<ApiResult<HealthResult>> {
  return getJson<HealthResult>(`${CHEM_API}/health`);
}

/** Identifier (name, CAS, InChIKey, SMILES) → canonical SMILES. */
export async function resolveName(query: string): Promise<ApiResult<ResolveResult>> {
  return getJson<ResolveResult>(`${CHEM_API}/resolve?q=${encodeURIComponent(query)}`);
}

export interface MoleculeOptions {
  /** Depiction size in px; the SVG keeps its viewBox and scales anyway. */
  width?: number;
  height?: number;
}

async function fetchMolecule(
  query: string,
  kind: 'name' | 'smiles',
  width: number,
  height: number
): Promise<ApiResult<MoleculeResult>> {
  const cacheKey = `${kind}:${query}:${width}x${height}`;
  const hit = moleculeCache.get(cacheKey);
  if (hit) return { ok: true, data: hit };

  const params = new URLSearchParams({ [kind]: query, w: String(width), h: String(height) });
  const result = await getJson<MoleculeResult>(`${CHEM_API}/molecule?${params}`);
  if (result.ok) moleculeCache.set(cacheKey, result.data);
  return result;
}

/**
 * One molecule, however the reader expressed it.
 *
 * `kind: 'auto'` guesses from the string and then CHECKS ITSELF: if the guess
 * comes back "not a structure" or "no such name", the other route is tried
 * before giving up. No heuristic separates chemical names from SMILES
 * reliably — 'styrene' is a perfectly good SMILES-shaped string — so the
 * cheap second request is what makes the single input field honest.
 */
export async function describeMolecule(
  query: string,
  kind: 'name' | 'smiles' | 'auto',
  options: MoleculeOptions = {}
): Promise<ApiResult<MoleculeResult>> {
  const { width = 320, height = 240 } = options;
  if (kind !== 'auto') return fetchMolecule(query, kind, width, height);

  const first = looksLikeSmiles(query) ? 'smiles' : 'name';
  const result = await fetchMolecule(query, first, width, height);
  if (result.ok) return result;

  // Only a verdict about the INPUT is worth a second opinion; a network or
  // service failure would fail identically the other way round.
  if (result.error.code !== 'bad_smiles' && result.error.code !== 'not_found') return result;

  const second = await fetchMolecule(query, first === 'smiles' ? 'name' : 'smiles', width, height);
  return second.ok ? second : result;
}

// --- predictions ---------------------------------------------------------
//
// Four models on the second service. They share a response envelope
// ({success, ...values} / {success: false, error}) that predates this site,
// so it is normalised here rather than at each call site.

export type PredictModel = 'rr' | 'kp' | 'tg' | 'ws';

export interface PredictPayload {
  smiles?: string;
  smiles1?: string;
  smiles2?: string;
}

/** Values only — the keys differ per model (r1/r2, kp/log_kp, tg, ws/log_ws). */
export type PredictResult = Record<string, number>;

export async function predict(
  model: PredictModel,
  payload: PredictPayload
): Promise<ApiResult<PredictResult>> {
  let response: Response;
  try {
    response = await fetch(`${PREDICT_API}/api/predict-${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: networkError(err) };
  }

  let body: { success?: boolean; error?: string; [key: string]: unknown };
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: { code: 'network', message: 'The model service returned an unreadable reply.' } };
  }

  if (!body.success) {
    return {
      ok: false,
      error: {
        // 503 is the service's own "models did not load" signal; anything
        // else it rejects is a bad structure.
        code: response.status === 503 ? 'upstream_unavailable' : 'bad_smiles',
        message: body.error ?? 'The model could not use that structure.',
      },
    };
  }

  const values: PredictResult = {};
  for (const [key, value] of Object.entries(body)) {
    if (key !== 'success' && typeof value === 'number') values[key] = value;
  }
  return { ok: true, data: values };
}

// --- input classification ------------------------------------------------

/**
 * A first guess at whether the reader typed a SMILES string or a name.
 *
 * Only ever a guess — describeMolecule('auto') verifies it against the
 * service and retries the other way. Two signals, in order of trust:
 *
 *  1. Structural characters (= # [ ] ( ) @ \ / *) appear in every non-trivial
 *     SMILES and in no chemical name.
 *  2. Failing that, a bare run of SMILES-legal characters with NO LOWERCASE
 *     VOWEL. This is what separates 'CCO' and 'c1ccccc1' from 'styrene' and
 *     'benzene': lowercase letters in SMILES are aromatic atoms (b c n o p s),
 *     so a lowercase a, e, i, u or y means English, not chemistry.
 */
export function looksLikeSmiles(input: string): boolean {
  const text = input.trim();
  if (!text || /\s/.test(text)) return false;
  // Two identifiers that are vowel-free and so would read as SMILES on the
  // rule below, but are unambiguously lookups: a CAS registry number and an
  // InChIKey.
  if (/^\d{2,7}-\d{2}-\d$/.test(text)) return false;
  if (/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(text)) return false;

  if (/[=#[\]()@\\/*]/.test(text)) return true;
  return /^[A-Za-z0-9+\-.%]+$/.test(text) && !/[aeiuy]/.test(text);
}

/** A repeat unit rather than a discrete molecule. */
export function isRepeatUnit(smiles: string): boolean {
  return smiles.includes('*');
}

/** Disconnected fragments — a copolymer's several repeat units in one string. */
export function isMultiFragment(smiles: string): boolean {
  return smiles.includes('.');
}
