// Every repeat-unit drawing as a file of its own, at /structures/<id>.svg,
// beside the 3D models already served from that folder. Entry pages inline
// their drawings at build time; this is for the Compare tool, which fetches
// only the ones a reader chooses. Written out from the same source files, so
// the two can never differ.
import type { APIRoute, GetStaticPaths } from 'astro';

const drawings = import.meta.glob<string>('../../assets/structures/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const getStaticPaths: GetStaticPaths = () =>
  Object.entries(drawings).map(([path, svg]) => ({
    params: { id: path.split('/').pop()!.replace(/\.svg$/, '') },
    props: { svg },
  }));

export const GET: APIRoute = ({ props }) =>
  new Response(props.svg as string, {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' },
  });
