// /catalogue.json — the lightweight structured-fields index (§9.3), a static
// build artifact powering the advanced catalogue table and the constellation
// view's layout computation. Not Pagefind: different query shape (structured
// filter/sort vs full-text).
import type { APIRoute } from 'astro';
import { catalogueIndex } from '../lib/derived';

export const GET: APIRoute = async () =>
  new Response(JSON.stringify(await catalogueIndex()), {
    headers: { 'Content-Type': 'application/json' },
  });
