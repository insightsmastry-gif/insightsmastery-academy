# InsightsMastery Academy

A fast, static learning site for the InsightsMastery handbooks — Power BI, DAX,
Power Query and SQL Server. Every note in `notes/` and every download in
`pdfs/` is discovered by the build and published automatically: no CMS, no
framework, no runtime dependencies.

**Live:** <https://insightsmastry-gif.github.io/insightsmastery-academy/>

- Plain HTML + CSS + ES modules in the browser. The build (Node 20+) uses two
  dev dependencies: `cheerio` (HTML parsing) and `sanitize-html` (allowlist
  sanitiser).
- Every handbook is prerendered to its own page (`notes/<slug>/`) with its own
  title, description, Open Graph tags and JSON-LD — readable and indexable
  without JavaScript.
- Light/dark themes, client-side search over titles, descriptions, tags and
  headings, keyboard shortcuts (can be switched off), and reduced-motion support.

## Project tree

```
index.html · notes.html · resources.html · about.html · 404.html   source pages
templates/note.html        reader template, filled once per handbook
notes/                     source handbooks (.html) — the content
pdfs/                      downloads (.pdf) — the content
content.config.json        site URL + optional metadata (categories, tags, descriptions)
assets/css/                fonts, tokens, base, components, prose, per-page styles
assets/js/                 theme · content · ui · keys + per-page modules
assets/fonts/              self-hosted Inter + JetBrains Mono (SIL OFL)
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
`robots.txt` and the local preview's base path come from it. Everything else is
optional; use it to set what a file cannot tell us — `category`, `tags`,
`description`, or an explicit `title`:

```json
{
  "site": { "url": "https://insightsmastry-gif.github.io/insightsmastery-academy/", "name": "InsightsMastery Academy" },
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
prints a `!` warning (a GitHub Actions annotation in CI) for every file that
fell through to the default category. Warnings never block a deploy: an
uploaded file is always published.

## Local development

```bash
npm ci             # once: installs the two build tools
npm start          # build, serve http://localhost:4173/insightsmastery-academy/, rebuild on save
npm run build      # build _site/
npm run check      # validate content only, write nothing
npm run verify     # build + check-site (what CI runs)
npm run serve      # serve an existing _site/ without rebuilding
node scripts/dev-server.mjs --port 8080   # or PORT=8080
```

The preview serves `_site/` under the same `/insightsmastery-academy/` base path
as GitHub Pages, so links, the 404 page and the Content-Security-Policy behave
as in production.

## Deployment

Push to `main`. `.github/workflows/deploy.yml` checks out full history (for git
dates), runs `npm ci` and `npm run verify`, and uploads only
`_site/` with `actions/deploy-pages`. README, scripts, templates, config and the
source handbooks are never published. Pull requests and other branches run the
same checks in `.github/workflows/ci.yml`.

Old reader links (`note.html?note=<slug>`) redirect to `notes/<slug>/`.

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
- Theme is painted before first paint from `localStorage`, so there is no flash.
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
