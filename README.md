# Atlas of Polymers

A free, history-narrated encyclopedia of the polymers that made the modern
world — 96 entries across seven eras (1833 onward), from nature's
macromolecules to designed smart materials. No ads, no logins, no tracking.

Each polymer page pairs an author-written historical narrative with a fully
structured, cited property dataset: identity, classification, history,
synthesis, structure & morphology, physical / thermal / mechanical
properties, chemical resistance, processing, applications, environmental &
recycling notes, and numbered references. Values that haven't been verified
yet say so honestly — nothing is faked.

Concept pages (the Carothers equation, glass transition, UCST/LCST, …)
carry build-time-rendered equations with variable legends alongside their
narratives.

**Browse**: a sortable, filterable catalogue (home), an era-colored
timeline (`/timeline/`), an infinite-canvas chart of polymer history
(`/constellation/`) — pan across two centuries, zoom from the sweep of eras
down to a single material, follow each family's strand, filter by era or
family,
full-text search (Ctrl-K / `/`, filterable by type and era, alias-aware —
searching "teflon" or "PE80" finds the right page), computed related-entry
links on every polymer page, and automatic cross-links wherever one entry's
narrative mentions another. Light/dark theme and three presentation styles
(Gilt · Vellum · Atelier) are switchable from the reading-preferences menu
in the header.

## Development

Built with [Astro](https://astro.build) as a fully static site, searched
with [Pagefind](https://pagefind.app) (indexed post-build — search needs a
production build).

```
npm install
npm run dev     # http://localhost:4321/PolymerAtlas/
npm run build   # static build into dist/ + Pagefind index
```

Content lives in `src/content/` (MDX narratives + JSON property data,
validated by Zod schemas), controlled vocabularies in `src/data/taxonomy/`,
and every citation resolves into `references.bib` — cross-file consistency
is enforced by integrity checks that run inside every build. Structured
data is also published as machine-readable artifacts at `/catalogue.json`
and `/timeline.json`. Deployment to GitHub Pages is automated via
`.github/workflows/deploy.yml`.

Chemical structures are drawn as one house style for the whole atlas: each
repeat unit is a 2D drawing (SVG, inlined so its ink follows the light or dark
theme) plus a 3D ball-and-stick model, shown together in a viewer on every
polymer page. Polymers with more than one configuration worth seeing -- cis
versus trans, 1,2-vinyl addition -- carry a drawing and a model for each.

## License

Text and data: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

The 3D viewer is [3Dmol.js](https://3dmol.csb.pitt.edu/), bundled at
`public/vendor/` under the BSD-3-Clause licence kept alongside it.
