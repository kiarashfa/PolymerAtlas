// The web app manifest, generated rather than static so every path in it
// runs through the base path the site is served under.
import type { APIRoute } from 'astro';
import { href } from '../lib/content';
import { SITE_NAME, SITE_SHORT_NAME, SITE_TAGLINE, PAPER_DARK } from '../lib/site';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        name: SITE_NAME,
        short_name: SITE_SHORT_NAME,
        description: `${SITE_NAME}, ${SITE_TAGLINE}.`,
        start_url: href('/'),
        scope: href('/'),
        display: 'standalone',
        // The icons are the mark on the dark paper; the splash matches them.
        background_color: PAPER_DARK,
        theme_color: PAPER_DARK,
        icons: [
          { src: href('/icon-192.png'), sizes: '192x192', type: 'image/png' },
          { src: href('/icon-512.png'), sizes: '512x512', type: 'image/png' },
          { src: href('/favicon.svg'), sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      null,
      2
    ),
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } }
  );
