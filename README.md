# InsightsMastery Academy

A fast, static learning site for the InsightsMastery handbooks — Power BI, DAX,
Power Query and SQL Server. Every note in `notes/` and every download in
`pdfs/` is discovered by a build script and published automatically: no CMS, no
framework, no dependencies.

**Live:** <https://insightsmastry-gif.github.io/insightsmastery-academy/>

- Plain HTML + CSS + ES modules. Zero npm dependencies, zero build tools.
- Content is data: pages render from `content/manifest.json`, generated from the
  files on disk.
- Light/dark themes, full-text client-side search, keyboard shortcuts, and
  reduced-motion support.

## Project tree

```
index.html                 landing page
notes.html                 searchable notes library
note.html                  reader (note.html?note=<slug>)
resources.html             PDF downloads
about.html · 404.html
notes/                     source handbooks (.html) — the content
pdfs/                      downloads (.pdf) — the content
content/manifest.json      GENERATED index of notes + pdfs (committed)
content.config.json        optional metadata (categories, tags, descriptions)
assets/css/                tokens, base, components, prose, per-page styles
assets/js/                 theme · content · ui · keys + per-page modules
scripts/build-manifest.mjs manifest generator (Node 18+, no deps)
scripts/dev-server.mjs     local static server
.github/workflows/deploy.yml  GitHub Pages build + deploy
```

## How to add a note

1. Drop any standalone `.html` file into `notes/`.
2. Run `npm run build`.
3. Commit both the note and the regenerated `content/manifest.json`, then push.

It appears on the home page, in the notes library, in search, and in the reader
with no code change. The build reads the file itself for:

| Field | Source in the file |
|---|---|
| title | `<title>` (the ` — InsightsMastery Academy` suffix is stripped), else the first `<h1>` |
| kicker | `p.kicker` |
| description | `<meta name="description">`, else the first descriptive `<p>` in `header.cover`, else `p.lead` |
| headings | every `<h2>`/`<h3>` inside `<main>` (the table of contents is ignored); missing `id`s are generated |
| words / reading time | `<main>` text at 210 wpm; `<pre>` code counts at 40% weight because snippets are skimmed |
| sections, size, last updated | `<section id=…>` count, file size, file mtime |

Filenames starting with `_` or `.` are skipped — handy for drafts.

## How to add a PDF

Drop it into `pdfs/`, run `npm run build`, commit, push. The title is derived
from the filename (`InsightsMastery_Time_Intelligence_DAX_Handbook.pdf` →
"Time Intelligence DAX Handbook"), and the size/date come from the file. A PDF
whose filename stem matches a note is automatically cross-linked: the note shows
a download button, the download links back to the note.

## Optional metadata — `content.config.json`

Everything in this file is optional; new files publish without touching it. Use
it to set what a file cannot tell us — `category`, `tags`, `description`, or an
explicit `title`:

```json
{
  "defaults": { "category": "General" },
  "rules": [
    { "match": "power_query", "category": "Power Query", "tags": ["Power Query"] }
  ],
  "notes":     { "My_New_Handbook.html": { "category": "DAX", "tags": ["DAX"] } },
  "resources": { "My_New_Handbook.pdf":  { "description": "Printable version." } }
}
```

Resolution order: exact filename entry → first matching `rules[].match`
(case-insensitive substring of the filename) → `defaults.category`. The build
prints a `!` warning for every file that fell through to the default category.

## Local development

No install step — Node 18+ is the only requirement.

```bash
npm start          # build the manifest, then serve http://localhost:4173
npm run serve      # serve only
npm run build      # regenerate content/manifest.json
npm run check      # build in memory and print the summary, write nothing
node scripts/dev-server.mjs --port 8080   # or PORT=8080
```

Opening the files directly with `file://` will not work: browsers block ES
module loading and `fetch()` on that scheme. Always use `npm start`.

## Deployment

Push to `main`. The workflow in `.github/workflows/deploy.yml` checks out the
repo, runs `npm run build`, and publishes the whole directory with
`actions/deploy-pages`. There is no `npm install` step because there are no
dependencies.

Alternative: because `content/manifest.json` is committed, GitHub Pages can also
serve directly from the branch root (Settings → Pages → Deploy from a branch →
`main` / `/`) with Actions disabled. Just remember to run `npm run build` before
committing new content in that mode.

`.nojekyll` keeps Pages from running Jekyll over the files. All URLs in the site
are relative, so it works under the `/insightsmastery-academy/` sub-path.
`robots.txt` allows every crawler and points at `sitemap.xml`; generating a
sitemap is out of scope, so that entry only resolves if you add the file
yourself.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `/` | Focus search |
| `T` | Toggle light/dark theme |
| `G` then `H` | Home |
| `G` then `N` | Notes library |
| `G` then `R` | Resources |
| `G` then `A` | About |
| `?` | Show the shortcuts dialog |
| `Esc` | Close dialog / blur search |

## Accessibility and performance

- WCAG 2.1 AA targets: visible focus rings, AA contrast in both themes, one
  `<h1>` per page, real `<button>`/`<a>` semantics, `aria-pressed` on toggles,
  `aria-live` on async lists, hit targets ≥ 40 px, everything keyboard reachable.
- `prefers-reduced-motion: reduce` disables reveal and counter animations;
  animations otherwise touch only `transform`/`opacity`.
- Theme is painted before first paint from `localStorage`, so there is no flash.
- No trackers, no analytics, no third-party JavaScript. The only external
  request is the Google Fonts stylesheet.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pages show "content index missing" | `content/manifest.json` was never built or not committed — run `npm run build` |
| Nothing loads from `file://` | Browsers block modules and `fetch` on that scheme — run `npm start` |
| A new note is missing | Re-run `npm run build`; check the filename does not start with `_` or `.` |
| A file lands in "General" | Add an entry or a rule in `content.config.json` (the build warns about these) |
| `port 4173 is busy` | `node scripts/dev-server.mjs --port 4174` |
| Deploy succeeded but content is stale | The workflow rebuilds the manifest — confirm the note itself was committed |
