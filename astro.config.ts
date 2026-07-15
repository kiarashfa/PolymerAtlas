import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import integrity from './src/integrations/integrity';
import rehypeAutolink from './src/lib/rehype-autolink';

// GitHub Pages project deploy — see instructions.md §9.2.
const base = '/PolymerAtlas';

export default defineConfig({
  site: 'https://kiarashfa.github.io',
  base,
  integrations: [integrity(), mdx(), sitemap()],
  markdown: {
    // §3.1 item 3: equations render at BUILD time (never client-side).
    // Narrative prose doesn't use $-math today (the author's text is never
    // rewritten), but any future concept derivation/worked-example MDX gets
    // KaTeX for free. Data-file equations render via katex.renderToString in
    // ConceptPage.
    remarkPlugins: [remarkMath],
    // Autolinking (§9.3) runs last, on the final HTML tree.
    rehypePlugins: [rehypeKatex, [rehypeAutolink, { base }]],
  },
});
