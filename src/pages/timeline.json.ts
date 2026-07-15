// /timeline.json — year→entries mapping with era metadata, multi-entry years
// first-class (§4.1, §9.3). The same timelineData() feeds the /timeline/
// page, so the two can never drift apart.
import type { APIRoute } from 'astro';
import { timelineData } from '../lib/derived';

export const GET: APIRoute = async () =>
  new Response(JSON.stringify({ eras: await timelineData() }), {
    headers: { 'Content-Type': 'application/json' },
  });
