# Atlas of Polymers

A free, history-narrated encyclopedia of the polymers that made the modern
world — 96 entries across seven eras (1833–2015), from nature's
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
timeline (`/timeline/`), full-text search (Ctrl-K / `/`, filterable by type
and era, alias-aware — searching "teflon" or "PE80" finds the right page),
computed related-entry links on every polymer page, and automatic
cross-links wherever one entry's narrative mentions another. Light/dark
theme and three presentation styles (Gilt · Vellum · Atelier) are
switchable in the header.

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

## License

Text and data: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
