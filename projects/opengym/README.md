# Opening Repertoire Trainer

A lightweight chess opening quizzer. Pick an opening, pick a colour, and play out the
main lines against an opponent that only plays book moves. Step off theory and you are
stopped, shown what went wrong, and asked to try again.

Openings are ranked by how often players at **your** rating actually reach them, so the
list you browse at 1200 is not the list you browse at 2100.

**No build step, no dependencies, no network calls at runtime.** Open `index.html` and it
runs — from a web server, from S3/GitHub Pages, or straight off the filesystem.

```sh
open index.html            # or: python3 -m http.server 8000
```

## Where the book comes from

Nothing in the book is hand-written. Two public-domain Lichess sources are pulled down,
processed, and re-served as a single static file:

| Source | Licence | Used for |
| --- | --- | --- |
| [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) | CC0 | 3,810 named ECO variations and their moves — the accepted naming book, the same one Lichess uses |
| [database.lichess.org](https://database.lichess.org/) | CC0 | 300,001 rated games, for how often each opening is played at each rating |

### The pipeline

```sh
node tools/fetch-openings.js                  # -> data/openings.tsv      (~390 KB)
node tools/fetch-popularity.js                # -> data/popularity.json   (~215 KB)
node tools/build-book.js                      # -> book.js                (~104 KB)
node test/validate.js                         # every line replayed through the engine
```

Both raw inputs are committed, so `build-book.js` reproduces `book.js` offline. Re-run the
fetchers when you want fresher data:

```sh
node tools/fetch-popularity.js --month 2026-09 --games 500000
node tools/build-book.js --keep 80            # how many openings to keep per band
```

`fetch-popularity.js` streams the monthly dump and cuts the connection once it has counted
enough games, so it downloads a slice rather than the whole month.

### What a "trainable opening" is

The ECO file names an opening at every depth it is recognised, so
`Sicilian Defense: Najdorf Variation` appears five times at five different lengths, and
sub-variations extend it. `build-book.js` turns that into something drillable:

- An **opening** is a family plus its first variation segment — `Sicilian Defense: Najdorf
  Variation` — and every named sub-variation beneath it becomes one **line**.
- Lines that are strict prefixes of other lines are dropped; they are interior nodes of the
  trie, not destinations.
- Transpositions that do not follow the opening's dominant move order are dropped, so a
  unit does not start from two different positions. (The Najdorf's Opocensky entry arrives
  via 2...Nf6, and is cut.)
- Lines sharing an ECO name are told apart by the moves on which they diverge, giving
  labels like `English Attack, 7...Be6 8.f3`.
- Openings with fewer than 2 lines, or no line reaching 8 plies, are dropped, as are
  generic buckets like "Queen's Pawn Game" that collect anything unclassified.

That leaves **83 openings / 658 lines / 8,144 plies**.

### How popularity is measured

Each game in the dump carries `WhiteElo`, `BlackElo` and an `Opening` header naming the
deepest book position it reached. Games are filed by the players' average rating:

| Band | Rating | Games |
| --- | --- | --- |
| Beginner | under 1400 | 94,902 |
| Intermediate | 1400–1999 | 170,333 |
| Advanced | 2000 and up | 34,766 |

An opening's count is the sum over every ECO name beneath it. Ranks and shares are computed
per band, which is what the Beginner/Intermediate/Advanced selector switches between. The
same numbers weight the **opponent's** replies, so at Beginner it answers the way players
under 1400 actually answer, not the way the main line says they should.

Worth knowing about the sample:

- Games come from the opening hours of one month, not spread across it.
- Bullet is excluded (estimated game length under 180s); opening choice there is reflex,
  not repertoire.
- The `Opening` header names where a game *left* book, so a count attaches to the deepest
  named position reached, not to every position passed through.
- The Advanced band is the smallest sample, so its tail ranks are the least stable.

### Going deeper: the opening explorer

The game dumps give one count per *game* (where it left book). The
[opening explorer](https://explorer.lichess.ovh) gives counts per *position* — every legal
continuation, with games and results, filtered by rating band. That is strictly better
data, and it is what `tools/fetch-explorer.js` collects:

```sh
node tools/fetch-explorer.js --dry        # how many requests this will take, no network
node tools/fetch-explorer.js --probe      # a single request, prints the raw response
node tools/fetch-explorer.js              # the full crawl -> data/explorer.jsonl
```

It walks every position the book passes through (2,515 of them) and asks for each of the
three bands: 7,545 requests, about 1.7 hours at the default 1.2 req/s. No account or API
token is needed. The crawl is resumable — each response is appended as it arrives and a
re-run skips what is already on disk — so Ctrl-C is safe. It backs off when the explorer
returns 429, honouring `Retry-After`.

Use `--depth 12` for a shorter crawl (4,683 requests) or `--rps` to change the pace; raise
it only if you are seeing no rate limiting.

With `data/explorer.jsonl` present, the book can carry true per-position move frequencies
rather than the "deepest named opening" proxy, and lines can be extended past the point
where ECO stops naming them.

## Files

| File | What it is |
| --- | --- |
| `chess.js` | 0x88 chess engine: legal move generation, SAN in and out, make/undo. No deps. |
| `book.js` | **Generated.** The served book: openings, lines, per-band popularity. |
| `app.js` | Library, move trie, board rendering, pointer input, the training loop. |
| `styles.css` | All styling, including both colour themes. |
| `tools/` | The pipeline stages above, plus `fetch-explorer.js`. |
| `data/` | Raw inputs, committed so builds are reproducible. |
| `test/validate.js` | Replays every line; checks labels and ranks. |
| `build.js` | Inlines everything into `dist/index.html` (one file). |

## How the training works

The lines of an opening compile into a **move trie** at load:

- At each position, the trie node's children are exactly the acceptable moves.
- If you play one, you advance. If you don't, the move is played, flagged red, and taken
  back — so you see what you tried before it disappears.
- The opponent answers with a real book move, weighted by play frequency in the selected
  band (every line gets +1 so rare variations still appear).
- Where a position has several book moves, all are accepted and the panel says so.

Two misses on the same move highlights the piece; a third (or **Show move**) names it. The
**Variation** dropdown narrows training to one line.

## Notes on the implementation

- **Pieces** are the cburnett SVGs — the set Lichess ships as its default — embedded as
  `<symbol>` defs (12 symbols, ~8 KB). Inline SVG rather than Unicode glyphs because
  Android font stacks miss the solid chess characters and iOS can promote them to emoji.
- **Input** supports drag and tap-tap on one pointer-event path, so desktop and touch
  behave identically.
- **Progress** lives in `localStorage`, wrapped in try/catch so private-mode browsers
  degrade quietly.

## Credits and licence

- Opening names and lines: [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) — **CC0**.
- Game data: [database.lichess.org](https://database.lichess.org/) — **CC0**.
- Piece artwork: **cburnett** by Colin M.L. Burnett, from
  [lichess-org/lila](https://github.com/lichess-org/lila/tree/master/public/piece/cburnett) — **CC BY-SA 3.0**,
  attributed in the page footer.

CC0 puts the two data sources in the public domain, with no conditions. CC BY-SA is
copyleft: it requires attribution and carries a share-alike obligation that travels with
the piece artwork, not with the rest of this codebase. If you intend to ship the whole
thing under a permissive licence, keep the piece files clearly separated or swap in a set
whose terms suit you.
