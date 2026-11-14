# Token Launch Radar — curve-1 (make.fun token-radar-01, v2)

A radar for pre-token protocols: it ranks 198 of them by an implied launch
value read off the market's own size curve, prices the farm for each one, and
shows the uncertainty instead of hiding it.

## The model, in one paragraph

An OLS fit of log10(market cap) on log10(TVL) over the 128 traded protocols
in the sealed snapshot (`log10(mcap) = 3.0247 + 0.5223 · log10(TVL)`, R² 0.19),
plus a shrunk category effect (≥5 traded peers, winsorized, clamped), plus
three bounded factors: 7-day growth, age with no token, chain breadth. Every
row carries a P25–P75 band from the model's own residuals, a reference-class
launch chance with an expected value, farm economics (airdrop per $1,000,
ticket, gas, net-of-gas verdict), and a six-step farm plan. Leave-one-out
backtest: median miss ×3.45, against ×5.07 for the flat global-median
multiple. Full method: `dashboard/METHOD.md`.

## Layout

- `main.ts` — entrypoint. Reads the snapshot, builds the board, writes
  `board.json`, `data.js`, `dashboard/`, `screenshots/`, `dossier.json`.
- `lib/model.ts` — the pure model: curve fit, category effects, pricing,
  backtest, farm economics, farm plans, board selection.
- `vendor/makefun-board.ts` — the kit's dossier builder, copied byte-for-byte.
- `dashboard/` — the static dashboard (index.html, app.css, app.js) plus
  `METHOD.md`, which the dossier prints for the judge.
- `screenshots/` — board, detail, filtered.

## Run

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Or with the kit layout: `MAKEFUN_INPUT_DIR=.../input MAKEFUN_OUTPUT_DIR=out
node main.ts`. Deterministic: two runs write identical bytes.

## Verify

```sh
python3 ../tools/validate_gate.py out ../kit/token-radar-01-kit/input/snapshot.json
node ../tools/render_check.mjs out
```

## v2 vs v1

v1 priced every protocol at a flat category-median multiple (0.21× for nearly
everyone) and showed a point estimate only. v2 replaces it with the fitted
size curve, adds the leave-one-out backtest, P25–P75 ranges, farm economics
in the main table, launch chance + expected value, and a denser cover with
the full funnel, the fitted formula, and the calibration chart. See
`../REPORT-v2.md` for the full comparison.
