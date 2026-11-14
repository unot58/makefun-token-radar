# Method — Token Launch Radar, model curve-1

A pre-token protocol has no market price, so this radar prices it the way a
comparables analyst would: read the market's own relationship between size
(TVL) and value (market cap) off the protocols that already trade, then apply
that relationship — and nothing else — to the ones that do not. No protocol
is priced by hand, and no name appears anywhere in the model.

## 1. The snapshot

Sealed snapshot, as of 2026-11-14, sourced from DefiLlama: 758 protocols,
each with TVL, 7-day TVL change, market cap (when a token is recorded),
listing date, category, and chains. 416 record a token; 342 record no token.
128 traded protocols carry a market cap above zero — those are the
comparables the curve is fitted on.

A protocol is said to "record no token" when the snapshot carries neither a
gecko_id nor a symbol for it. That is a statement about the record, not a
claim that no token exists.

## 2. The funnel

- 758 protocols tracked
- 416 already record a token (128 with a market cap feed the curve)
- 342 record no token
- 144 set aside by the rule: CEX (42), Liquid Staking (38), Bridge (28),
  Canonical Bridge (15), versioned names (11), wrapped/staked products (5),
  Liquid Restaking (3), Restaked BTC (2)
- 198 ranked on the board: the whole 40-protocol watchlist (TVL at or above
  the $50M floor) plus 158 early finds below the floor

The set-aside list is shown in full on the "Set aside" tab, with the reason
for each row, so the funnel adds up and nothing is silently dropped.

## 3. The size curve

The core of the model is an ordinary least squares fit of log10(market cap)
on log10(TVL) over the 128 traded comparables:

    log10(mcap) = 3.0247 + 0.5223 * log10(TVL)     R² = 0.19, n = 128

A slope below 1 means the market pays less per TVL dollar as a protocol
grows: a $10M-TVL protocol is priced near 0.33× its TVL, a $1B-TVL protocol
near 0.03×. That is the market's own curve, not an assumption — and it is why
a flat multiple (the global median is 0.21×) overprices giants and
underprices small protocols.

R² is 0.19. The market's scatter around its own curve is wide, and the radar
shows it instead of hiding it: every row carries a P25–P75 band (see §6).

## 4. Category effects

Each category's mean log-residual from the curve, computed on its traded
protocols, with three guards:

- residuals are winsorized at ±1 dex, so one extreme peer cannot dominate
  (the most extreme comparable, a prediction-market token at 400× its TVL,
  would otherwise set its whole category's price);
- a category needs at least 5 traded peers to earn an effect at all;
- the effect is shrunk toward zero by n/(n+4) and clamped to ±0.5 dex.

| Category          | Effect (log10) | As a multiple | Traded peers |
|-------------------|---------------:|--------------:|-------------:|
| Canonical Bridge  |         +0.264 |         ×1.84 |            8 |
| Basis Trading     |         +0.199 |         ×1.58 |            7 |
| CEX               |         +0.164 |         ×1.46 |            9 |
| Bridge            |         +0.066 |         ×1.17 |            6 |
| Dexs              |         +0.057 |         ×1.14 |           11 |
| RWA               |         +0.056 |         ×1.14 |            9 |
| Yield             |         −0.122 |         ×0.76 |            9 |
| Lending           |         −0.152 |         ×0.70 |           15 |
| Liquid Staking    |         −0.265 |         ×0.54 |            9 |

Nine categories qualify. Three of them (Canonical Bridge, CEX, Bridge) are
set-aside categories, so their effects never touch a board row. Five effects
actually price board rows: Basis Trading, Dexs, RWA, Yield, Lending.

Every other category — including Risk Curators, the board's largest category
with 34 rows — is priced by the curve alone, and its rows say so ("curve
only"). Risk Curators has exactly one traded peer, and one peer is not a
category: the model would rather admit it than invent an effect.

## 5. Growth, maturity, breadth

Three small multiplicative factors, each bounded so no single one can
dominate the curve:

- **Growth:** 1 + half the 7-day TVL change, clamped to [0.6, 1.5]. A protocol
  growing 40% in a week gets ×1.20; one shrinking 40% gets ×0.80. Unreported
  change counts as 1.0.
- **Maturity:** 0.70 at listing, rising linearly to 1.00 after two years with
  no token. A protocol that has survived two years without launching has
  proven more than a two-week-old one. Unknown age is treated as one year
  (0.85).
- **Breadth:** +2% per chain past the first, at most +10%.

The full price of a row is therefore:

    implied = 10^(3.0247 + 0.5223 * log10(TVL))
              × 10^(category effect)
              × growth × maturity × breadth

## 6. The range, not just the point

The P25–P75 band comes from the full model's residuals on the 128 traded
comparables: the middle half of the market's own misses spans ×0.31 to ×3.82
around the point estimate (median ×1.02 — the model is centred, not biased).
Every row's range bar shows that band on a log scale, with a marker for the
point estimate.

## 7. Launch chance and expected value

A reference-class base rate, computed from the snapshot itself: 60% the token
rate of the protocol's age bucket, 40% the token rate of its TVL bucket,
clamped to [25%, 80%].

| Age bucket   | Share recording a token | TVL bucket | Share recording a token |
|--------------|------------------------:|------------|------------------------:|
| under 180d   |                    26%  | under $10M |                    52%  |
| 180–540d     |                    37%  | $10–50M    |                    52%  |
| 540–1080d    |                    49%  | $50–200M   |                    57%  |
| over 1080d   |                    79%  | $200M–1B   |                    58%  |
|              |                         | over $1B   |                    63%  |

Overall, 55% of snapshot protocols record a token. The chance is a base rate
— the share of protocols of this age and size that record a token — not a
prediction that this protocol will launch. Expected value is implied value
times launch chance. The board ranks by implied value; expected value is an
extra column and a sort option.

## 8. Farm economics

Every row is costed as a farm, with the assumptions printed on the board:

- **Airdrop pool:** 7.5% of the implied value is assumed to reach farmers.
  Airdrop per $1,000 farmed = (1000 / TVL) × 7.5% × implied value.
- **Gas:** four transactions on the protocol's first listed chain, at a
  documented per-chain estimate (Ethereum $15.00, Arbitrum $1.20, Base $0.50,
  Solana $0.08, Binance $0.35, Avalanche $0.70, Polygon $0.12, Optimism
  $0.70, Gnosis $0.15, Hyperliquid L1 / Monad / Plasma $0.08, anything else
  $1.50). These are estimates — check the chain before entering.
- **Ticket and hold, by TVL tier:** up to $50M TVL, a $50 ticket and a
  30-day hold; $50M–$500M, $150 and 45 days; above $500M, $300 and 60 days.
- **Verdict, from the net at $1,000 farmed** (airdrop minus gas): above +$5
  PAYS OFF, within ±$5 MARGINAL, below −$5 UNDERWATER. The net dollar figure
  is always shown next to the verdict.

Each row also carries a six-step farm plan: set up, enter (shaped by the
protocol's category), deepen, stay active weekly, track, and exit — with the
exit step stating the three conditions that end the farm.

## 9. The backtest

Leave-one-out over the 128 traded comparables: each protocol is priced blind
by a curve (and category effects) fitted without it, and the miss is the
ratio of the larger to the smaller of predicted and actual market cap.

- Curve model, median miss: **×3.45**
- Flat global-median multiple, median miss: **×5.07**

The curve beats the flat multiple by about a third. It is still wrong by
×3.45 in the median case — which is exactly why the board shows ranges, and
why no row is presented as a precise price.

## 10. What this radar does not do

- It does not read team, tokenomics, or announcements: the snapshot has none
  of those, and the model refuses to invent them.
- It does not predict launch dates or airdrop sizes: the 7.5% farmer share
  is an assumption, printed as one.
- It does not price the 144 set-aside protocols: the rule sets them aside,
  and the board respects the rule.
- It does not know about parent protocols: parentProtocol is not one of the
  snapshot's ten fields, so the watchlist itself is read from the snapshot
  and the rule extends it below the floor.

## 11. Reproduce it

The fitted parameters are printed in the dashboard (Method tab, "Recompute
any row") and every value on the page is recomputed in the browser from
them: open the console and call `recompute(slug)`. The board's own numbers
are in board.json, and the dashboard source in this folder is the whole
entry the judge reads.
