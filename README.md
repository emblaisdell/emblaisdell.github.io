# Eben Blaisdell Info Site Docs

## General subtitle:

Mathematician | Maker

## Blurb

Hello, I'm Eben! I'm a mathematical logician who loves bringing ideas into the real world.

Professionally, I work for MITRE as a senior cyber security researcher, using my logical background to help defenders bring new tools to bear against real threats.  These tools span AI/ML, formal methods, and AI/ML for formal methods.  Understanding, from human subject matter experts and computer formal knowledgebases, is vital during design, development, and deployment.  My projects keep

More broadly- and more recently- I work on applying AI/ML to NP-complete problems. These domains have
- complex solution space with inefficient naive search,
- efficient _deterministic_ verification of solutions, and
- limited or no consequences of failure.
These are the low-hanging fruit of AI, but I'm still pulling fruit (TODO link to future ladybug blog).

Personally, I have lots of fun small ideas and love getting to make them. A sample lives below.

## Favorite Quotes

The one by Whitehead about carefully using mental effort. (Whitehead is my academic
great-grandfather, which the page now notes.)

The one by Alan Watts about the world being fundamentally playful. Candidates below
(strongest first) — all from his recorded lectures, so wording varies slightly between
transcripts:

1. **(Best fit — the "music" passage)**
   > Existence is basically playful. There is no necessity for it whatsoever. It isn't
   > going anywhere, that is to say, it doesn't have some destination that it ought to
   > arrive at. It is best understood by analogy with music, because music, as an art
   > form, is essentially playful. We say "you *play* the piano," you don't "work" the
   > piano.
   > — Alan Watts (lecture)

2. **(Shorter, on work vs. play)**
   > This is the real secret of life — to be completely engaged with what you are doing
   > in the here and now. And instead of calling it work, realize it is play.
   > — Alan Watts

3. **(On the universe as play — "lila")**
   > The universe is fundamentally at play. It is the dance of Shiva, the play of the
   > divine, with no purpose beyond the dancing itself.
   > — Alan Watts (paraphrase of his recurring theme drawn from the Hindu idea of *lila*)

_Note: #1 and #2 are close to his actual recorded wording; #3 is a paraphrase of a theme
he returned to often rather than a verbatim quote — verify against a transcript before
publishing if exact attribution matters._

_(Both quotes now render on the page: the Whitehead quote and Watts candidate #1, the
"existence is basically playful" passage.)_

## Picture

Several pictures of me live in `/pics_of_me`. One is chosen at random on each page load. **(Live)**

## Rest of site

The home page (`index.html`) links to four sections, each a folder with its own page that
shares one stylesheet (`assets/section.css`).

### Blog

`/blogs/` — writing on math / ML / life. **(Page live; first post in progress)**
The first draft, *Iterative Blogging* (`blogs/iterativeblogging.md`), is being written; it
is not yet wired into the page, which currently shows a "no posts yet" state.

### Short Stories

`/stories/` — short fiction I want to write. **(Page live; no stories yet)**

### Games

`/games/` — games I made as a kid, rebuilt for the browser. **(Live)**
The landing page lists each game with a screenshot and description:
- **Metrordle** (`games/metrordle/`) — guess the secret transit station from shared lines and
  direction (Washington Metro + Philadelphia).
- **Cloud the Peacekeeper** (`games/cloudthepeacekeeper/`) — you're a cloud keeping a town
  alive with careful lightning. Copied from its Electron source as static files only.

Each game folder is a one-time snapshot of its source project, not a live sync.

### Projects

`/projects/` — mostly physical things I've built for fun. **(Page live; write-ups in progress)**
`projects/AT-TV/` is started but empty; the page currently shows a "write-ups coming" state.

### Legacy

Earlier standalone pages (`eweek`, `humanturingmachine`, `robotbeerpong`, `sequent`) were
moved under `/legacy/` and are still reachable there. (`ontolog` stays at the top level,
`/ontolog/`, because other code references that original location.)


## Theming

The home page picks a theme at random on each load. **(Live)**

There are four themes (footer label → CSS class):
- **Academic** (`theme-academic`) — pure-HTML serif, black on white.
- **Bootstrap 2012** (`theme-bootstrap`) — early-2010s light Bootstrap, glossy gradients.
- **Vibe Glow** (`theme-vibe`) — dark theme with neon gradient accents and glowing cards.
- **Calligraphic** (`theme-calligraphic`) — sleek, classy, professional editorial look.

The chosen theme is applied as a class on the `<html>` element (set before first paint to
avoid a flash). A footer shows the current theme name and a "↻ shuffle theme" control to
cycle through the others. The section pages (blog/stories/games/projects) always use the
Calligraphic look via `assets/section.css`, so they stay consistent regardless of the
home page's random theme.
