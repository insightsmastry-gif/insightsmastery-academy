# InsightsMastery Academy

A fast, static learning site for the InsightsMastery handbooks — Power BI, DAX,
Power Query and SQL Server. Every note in `notes/` and every download in
`pdfs/` is discovered by the build and published automatically: no CMS, no
framework, no runtime dependencies.

**Live:** <https://notes.insightsmastry.in/>

- Plain HTML + CSS + ES modules in the browser. The build (Node 20+) uses three
  dev dependencies: `cheerio` (HTML parsing), `sanitize-html` (allowlist
  sanitiser) and `@typesafe-ai/sdk` (automatic labels).
- Every handbook is prerendered to its own page (`notes/<slug>/`) with its own
  title, description, Open Graph tags and JSON-LD — readable and indexable
  without JavaScript.
- Styled as a sub-site of <https://www.insightsmastry.in/>: same logo, banner
  header, cyan/teal palette, Outfit + Inter type. Light by default (the parent
  site's look) with an optional dark theme; client-side search over titles,
  descriptions, tags and headings; keyboard shortcuts (can be switched off);
  reduced-motion support.

## Project tree

```
index.html · notes.html · resources.html · about.html · 404.html   source pages
templates/note.html        reader template, filled once per handbook
notes/                     source handbooks (.html) — the content
pdfs/                      downloads (.pdf) — the content
content.config.json        site URL + optional metadata (categories, tags, descriptions)
assets/css/                fonts, tokens, base, components, prose, per-page styles
assets/js/                 theme · content · ui · keys + per-page modules
assets/fonts/              self-hosted Outfit, Inter + JetBrains Mono (SIL OFL)
scripts/build.mjs          builds _site/ (manifest, pages, note pages, sitemap)
scripts/check-site.mjs     verifies _site/ (links, CSP, JSON-LD, leaks)
scripts/dev-server.mjs     local preview of _site/ with rebuild-on-save
scripts/lib/               manifest, note parsing/sanitising, text helpers
.github/workflows/         ci.yml (every PR/branch) · deploy.yml (main → Pages)
```

`_site/` is the build output and is never committed.

## How to add a note

1. Upload any standalone `.html` file into `notes/` — on GitHub: open `notes/`
   → **Add file → Upload files** → commit to `main`. No code change, no config.
2. The deploy workflow rebuilds and publishes the site (about two minutes).

The build gives it a page at `notes/<slug>/`, lists it on the home page, in the
notes library, in search and in `sitemap.xml`. It reads the file itself for:

| Field | Source in the file |
|---|---|
| title | `<title>` (the ` — InsightsMastery Academy` suffix is stripped), else the first `<h1>` |
| kicker | `p.kicker` |
| description | `<meta name="description">`, else the first descriptive `<p>` in `header.cover`, else `p.lead`, else the first paragraph |
| body | `<main>`, else `.page`, else `<body>` — minus cover, headers, footers, `nav.toc`, `<h1>`, styles and scripts |
| headings | every `<h2>`/`<h3>` in the body; missing or duplicate `id`s are generated |
| words / reading time | body text at 210 wpm; `<pre>` code counts at 40% weight because snippets are skimmed |
| sections | `<section id=…>` count, else the number of `<h2>`s |
| last updated | date of the file's last git commit |

The body passes an allowlist sanitiser (`scripts/lib/note.mjs`): only common
text, list, table, code and image tags survive, attributes are limited to
`id`/`class`/`title`/ARIA and a few structural ones, links must be `http(s)` or
`mailto`, and images `https` or `data:`. Inline styles and scripts never reach
the page.

Filenames starting with `_` or `.` are skipped — handy for drafts.

## How to add a PDF

Upload it into `pdfs/` the same way (or commit and push). The title is derived from the filename
(`InsightsMastery_Time_Intelligence_DAX_Handbook.pdf` → "Time Intelligence DAX
Handbook"), the size from the file and the date from git. A PDF whose filename
stem matches a note is cross-linked: the note shows a download button, the
download links back to the note.

## Metadata — `content.config.json`

`site.url` (absolute, ending in `/`) is required: canonical URLs, the sitemap,
`robots.txt` and the local preview's base path come from it. `categories` lists
the library's categories with a one-line description each — the automatic
labelling below chooses from them. Everything else is optional; use it to pin
what should not be inferred — `category`, `tags`, `level`, `description`, or an
explicit `title`:

```json
{
  "site": { "url": "https://notes.insightsmastry.in/", "name": "InsightsMastery Academy" },
  "categories": { "DAX": "Writing DAX: measures, CALCULATE and filter context, …" },
  "defaults": { "category": "General" },
  "rules": [
    { "match": "power_query", "category": "Power Query", "tags": ["Power Query"] }
  ],
  "notes":     { "My_New_Handbook.html": { "category": "DAX", "tags": ["DAX"], "level": "Beginner" } },
  "resources": { "My_New_Handbook.pdf":  { "description": "Printable version." } }
}
```

Resolution order, per field: exact filename entry → automatic label (when
confident enough) → first matching `rules[].match` (case-insensitive substring
of the filename) → `defaults.category`. The build prints a `!` warning (a GitHub
Actions annotation in CI) for every file that fell through to the default
category. Warnings never block a deploy: an uploaded file is always published.

## Automatic labels (TypeSafe)

New uploads are categorised, tagged and levelled without editing the config.
At build time `scripts/lib/labels.mjs` sends each file's evidence — title,
description, headings and opening text for notes; a note twin's text, or else
the file name and description, for PDFs — to TypeSafe's System One API with one
request per file:

| Question | Type | Used when |
|---|---|---|
| Which `categories` entry does it mainly teach (or none)? | Choice | confidence ≥ 0.5 and not "none" |
| Beginner / Intermediate / Advanced | Score | confidence ≥ 0.4 (nearest level) |
| Is `<tag>` a main topic? — one per tag used anywhere in the config | Noul | probability ≥ 0.7, top 5 |

Thresholds live in `POLICY` in `scripts/lib/manifest.mjs`. Levels appear as
badges and as a "level" filter in the notes library (`?level=Beginner`).

- **Key:** `TYPESAFE_API_KEY` — a repository secret for the workflows, an
  environment variable locally. Without it, or if the API fails, the build
  logs a note and uses the config rules; publishing never depends on the API.
- **Cache:** answers are stored in `.cache/typesafe-labels.json`, keyed by a hash
  of the exact evidence and questions, so each file is judged once. CI keeps the
  cache between runs with `actions/cache`; editing a file (or the categories/tag
  vocabulary) re-labels only what changed. Bump `QUESTIONS_VERSION` in
  `labels.mjs` after changing the question wording.

## Local development

```bash
npm ci             # once: installs the build tools
npm start          # build, serve http://localhost:4173/, rebuild on save
npm run build      # build _site/
npm run check      # validate content only, write nothing
npm run verify     # build + check-site (what CI runs)
npm run serve      # serve an existing _site/ without rebuilding
node scripts/dev-server.mjs --port 8080   # or PORT=8080
```

The preview serves `_site/` under the same base path as production (taken from
`site.url`; `/` for the custom domain), so links, the 404 page and the
Content-Security-Policy behave as in production.

## Deployment

Push to `main`. `.github/workflows/deploy.yml` checks out full history (for git
dates), runs `npm ci` and `npm run verify`, and uploads only
`_site/` with `actions/deploy-pages`. README, scripts, templates, config and the
source handbooks are never published. Pull requests and other branches run the
same checks in `.github/workflows/ci.yml`.

Old reader links (`note.html?note=<slug>`) redirect to `notes/<slug>/`.

### Custom domain

The site is served at <https://notes.insightsmastry.in/>:

- DNS (GoDaddy): `CNAME notes → insightsmastry-gif.github.io`.
- GitHub: Settings → Pages → Custom domain `notes.insightsmastry.in`, with
  "Enforce HTTPS" on. With Actions deploys no `CNAME` file is needed.
- `site.url` in `content.config.json` drives canonical URLs, Open Graph tags,
  the sitemap and `robots.txt`; change it there if the domain ever moves.

Old `insightsmastry-gif.github.io/insightsmastery-academy/…` links redirect to
the custom domain automatically.

## Security and caching

- Every page ships a `Content-Security-Policy` meta tag: scripts, styles, fonts
  and fetches are same-origin only; the one inline script per page is allowed
  by its SHA-256 hash, computed at build time. No third-party requests.
- CSS is bundled per page and JS modules are content-hashed
  (`site.<hash>.css`, `ui.<hash>.js`), so a deploy can never mix old and new
  files.

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

Single-key shortcuts can be turned off from the shortcuts dialog (keyboard
button in the header); the choice is stored in `localStorage` (`im-shortcuts`).

## Accessibility and performance

- WCAG 2.1 AA targets: visible focus rings, AA contrast in both themes, one
  `<h1>` per page, real `<button>`/`<a>` semantics, `aria-pressed` on toggles,
  `aria-live` on result counts, hit targets ≥ 40 px, everything keyboard reachable.
- `prefers-reduced-motion: reduce` disables reveal and counter animations;
  animations otherwise touch only `transform`/`opacity`.
- Theme is painted before first paint from `localStorage` (light unless the
  reader chose dark), so there is no flash.
  Content is hidden for the fade-in only when JavaScript runs (`html.js`); with
  JavaScript off, or if a module fails to load, every page stays readable, and
  the notes and downloads lists fall back to plain links.
- No trackers, no analytics, no third-party requests: fonts are self-hosted.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pages show "content index missing" | `_site/` was not built — run `npm start` or `npm run build` |
| A new note is missing | Check the filename does not start with `_` or `.`, then rebuild |
| A file lands in "General" | Add an entry or a rule in `content.config.json` |
| Deploy fails at `npm run verify` | `check-site` lists each broken link, missing CSP, bad JSON-LD or leaked file |
| "Updated" shows today for a new file | It is not committed yet; the date comes from git |
| `port 4173 is busy` | `node scripts/dev-server.mjs --port 4174` |
