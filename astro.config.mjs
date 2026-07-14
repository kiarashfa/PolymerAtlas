import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// GitHub Pages project deploy — see instructions.md §9.2.
export default defineConfig({
  site: 'https://kiarashfa.github.io',
  base: '/PolymerAtlas',
  integrations: [mdx(), sitemap()],
});
