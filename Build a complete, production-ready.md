Build a complete, production-ready, enterprise-grade Learning SaaS website with a premium, modern, animated design. Deploy it as a static site on GitHub Pages.

### Core Requirements
- Clean, professional SaaS aesthetic (inspired by modern platforms like Notion, Linear, Stripe, or Vercel Academy).
- Fully responsive (mobile-first), accessible (WCAG 2.1 AA), and performant.
- Smooth, high-quality animations and micro-interactions (Framer Motion or pure CSS + Intersection Observer preferred for GitHub Pages compatibility).
- Dark/Light mode toggle with system preference detection and persistent preference (localStorage).
- Premium feel: subtle gradients, glassmorphism where appropriate, soft shadows, refined typography, elegant hover states, and polished loading/empty states.
- Interactive elements throughout (animated cards, progress indicators, expandable sections, smooth page transitions).

### Tech Stack (GitHub Pages friendly)
- Pure HTML + CSS + Vanilla JS, or lightweight modern stack that builds to static files (e.g. Vite + vanilla, Astro, or Next.js static export).
- No backend required. Everything must work as a static site.
- Tailwind CSS (or equivalent utility-first) for rapid, consistent styling.
- Optional: Lucide or Heroicons for icons, GSAP or Framer Motion for advanced animations if the chosen stack supports it cleanly.
- Structure the project so it can be pushed directly to a GitHub repository and deployed via GitHub Pages (root or /docs folder, or GitHub Actions for build).

### Site Structure & Pages
1. **Home / Landing**
   - Hero section with strong value proposition for a learning platform.
   - Feature highlights with animated cards.
   - Call-to-action to Notes and Resources.
   - Subtle background animations (particles, gradient orbs, or geometric shapes that move gently).

2. **Notes Section** (core feature)
   - Automatically discover and list all .html files from a `/notes` (or `/content/notes`) folder in the repository.
   - Display them as beautiful, interactive cards or a clean list with:
     - Title (extracted from <title> or first <h1>)
     - Short description / excerpt
     - Reading time estimate
     - Tags or category if present
     - Last modified date
   - Clicking a note opens it in a premium reading view:
     - Clean, readable typography (optimal line length, good contrast)
     - Table of contents (auto-generated from headings) that sticks on desktop
     - Progress bar at the top
     - Smooth scroll animations
     - “Back to Notes” navigation
   - Search + filter functionality for notes.
   - Empty state and loading skeleton.

3. **Resources / Downloads Section**
   - Automatically list all PDF files from a `/pdfs` (or `/content/pdfs`) folder.
   - Beautiful download cards showing:
     - File name (cleaned)
     - File size
     - Optional description or category
     - Direct download button (with download attribute or proper link)
   - Group or filter by category if possible.
   - Clear visual hierarchy and hover effects.

4. **Additional Pages**
   - About / How it works
   - Simple contact or feedback section (can be a form that opens mailto or links to GitHub Issues)
   - 404 page with personality

### Automatic Content Discovery (Critical)
- On page load (or at build time if using a static site generator), scan the `/notes` folder for all `.html` files and the `/pdfs` folder for all `.pdf` files.
- Generate the Notes list and Downloads list dynamically from the actual files present in the GitHub repository.
- No hard-coded list of notes or PDFs. Adding a new HTML file to `/notes` or a new PDF to `/pdfs` and pushing to GitHub should automatically make it appear on the live site after the next deploy.
- Prefer a simple build-time solution (e.g. a small Node script that generates a `manifest.json` or injects data) so the site remains pure static. Fallback to client-side fetching of a generated index if needed.

### Design & Animation Guidelines
- Typography: Inter / Geist / SF Pro style (system fonts + one premium web font).
- Color system: sophisticated neutral base + one strong accent color. Support both light and dark themes perfectly.
- Animations:
  - Page load: staggered fade-up of sections
  - Cards: subtle lift + shadow on hover
  - Reading progress indicator
  - Smooth transitions between notes list ↔ note detail
  - Micro-interactions on buttons, toggles, and filters
- Keep animations performant (prefer transform/opacity, respect prefers-reduced-motion).

### Project Structure Suggestion


/
├── index.html (or app entry)
├── notes/                  ← drop any .html files here → they appear in Notes
├── pdfs/                   ← drop any .pdf files here → they become downloadable
├── assets/
│   ├── css/
│   ├── js/
│   └── images/
├── scripts/                ← build-time script that generates content manifest
├── package.json
├── vite.config.js (or equivalent)
└── README.md (with clear GitHub Pages deployment instructions)


### Deployment
- Configure for GitHub Pages (either from main branch root, /docs, or GitHub Actions workflow).
- Include a clear README with:
  - How to add new notes (just drop HTML files into /notes)
  - How to add new PDFs (drop into /pdfs)
  - How to deploy / update the site
  - Local development instructions

### Extra Premium Touches
- Keyboard navigation support
- Reading mode enhancements (font size toggle, focus mode)
- Share buttons for individual notes
- Beautiful empty states and error handling
- SEO basics (meta tags, Open Graph)
- Fast load times and good Lighthouse scores

Deliver a complete, working codebase that I can push to a GitHub repository and enable GitHub Pages on. The site must feel premium, interactive, and truly enterprise-grade while remaining simple to maintain (add content = just add files to the folders).