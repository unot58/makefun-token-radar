# Token Radar — peer-priced launch radar

A program that reads a sealed snapshot of the DeFi protocol universe and writes a
web dashboard ranking the protocols that record no token yet by what their launch
would be worth, each with a concrete plan to farm it. Built for make.fun's
token-radar-01 bounty.

## The model

Each protocol is priced at what the market already pays for the same kind of
business: the **median market-cap-per-dollar-of-TVL of its traded peers**, computed
from the snapshot at run time — never typed in. A category with fewer than three
traded peers falls back to the global median (0.2138× on this snapshot).

```
implied value = TVL
  × peer multiple    median mcap/TVL of the category's traded peers, clamped [0.05, 1.50],
                     rounded to 4 decimals before use
  × growth           1 + half the 7-day TVL change, change clamped to [-60, +120]%
  × maturity         0.70 at launch, rising to 1.00 after two years; unknown age counts as 365 days
  × breadth          +2% per extra chain, up to ten extra chains
```

The board holds every launch candidate in the snapshot: all 40 watchlist protocols
plus 158 early finds below the $50M floor (198 rows). The watchlist's exclusion rule
is applied board-wide, so no wrapped, staked or bridged product, no versioned copy
and no exchange-branded product appears. The dashboard's Live tab shows the 128
protocols whose token already trades, priced by the same model, for comparison.

## Farm plans

Six steps per protocol, each with what it costs and how long it takes: set up a fresh
wallet, use the protocol, use it again a week later, use it on a second chain (or
check in weekly when it runs on one chain only), hold for 30–60 days by the
protocol's age, then claim — only from the protocol's own published link, and never
by paying anyone. The action follows the category (lend, add liquidity, deposit in a
vault, mint, bridge…) and the capital follows the TVL tier ($50–$250).

## How to run

Node 22 or later, standard library only; nothing is installed.

```
MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

That writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`
into the output directory. The entry ships its three screenshots (board, detail view,
filtered view, 1440×900), so they must exist in `screenshots/` before it runs.
The dashboard is static and loads no network: open `out/dashboard/index.html`
from a local server.

## Layout

- `main.ts` — entrypoint: snapshot in, board + data + dashboard + dossier out
- `lib/model.ts` — the radar-2 model, the board builder, the farm-plan generator
- `vendor/makefun-board.ts` — make.fun's dossier library, byte-identical to the kit
- `dashboard/` — the static page (index.html, app.css, app.js)
- `screenshots/` — the three screenshots of the page
