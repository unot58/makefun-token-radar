// Token Launch Radar — model "curve-1".
//
// A pre-token protocol's implied launch value is read off the market's own
// size curve: an OLS fit of log10(market cap) on log10(TVL) over the traded
// protocols in the sealed snapshot, with a shrunk category effect, and three
// small multiplicative factors (7-day growth, age with no token, chain
// breadth). Nothing here names a protocol: every number is fitted from the
// snapshot's own figures, and the backtest below prices the model blind.
//
// Pure functions only: no I/O, no clock, no randomness. main.ts does the I/O.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// ------------------------------------------------------------------ rules

/** Categories the watchlist rule treats as wrapped, staked or bridged products. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** True when DefiLlama's record carries no token for the protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * Why a pre-token protocol is set aside (null when it is board-eligible):
 * the watchlist rule's own exclusions, minus the size floor. The one
 * exclusion this cannot see is a parent protocol: parentProtocol is not one
 * of the snapshot's ten fields, so the house watchlist is read from the
 * snapshot itself and this rule only extends it below the floor.
 */
export function setAsideReason(p: SnapshotProtocol): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSION_SUFFIX.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE_PREFIXES.some((x) => p.name.startsWith(x))) return 'exchange product';
  return null;
}

/** Age in days since DefiLlama began tracking the protocol; null when unknown. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  const [y, m, d] = p.listed_at.split('-').map(Number);
  const [ay, am, ad] = asOf.split('-').map(Number);
  const listed = Date.UTC(y, m - 1, d);
  const at = Date.UTC(ay, am - 1, ad);
  return Math.max(0, Math.round((at - listed) / 86400000));
}

// ------------------------------------------------------------------ the size curve

export interface CurveFit {
  /** Intercept of log10(mcap) = a + b * log10(TVL). */
  a: number;
  /** Slope of log10(mcap) = a + b * log10(TVL). */
  b: number;
  /** R-squared of the fit on the traded protocols. */
  r2: number;
  /** Traded protocols the curve was fitted on. */
  n: number;
}

/** Ordinary least squares on log10(market cap) against log10(TVL). */
export function fitCurve(traded: SnapshotProtocol[]): CurveFit {
  const xs = traded.map((p) => Math.log10(p.tvl_usd));
  const ys = traded.map((p) => Math.log10(p.mcap_usd as number));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = a + b * xs[i];
    ssRes += (ys[i] - pred) * (ys[i] - pred);
    ssTot += (ys[i] - my) * (ys[i] - my);
  }
  return { a, b, r2: 1 - ssRes / ssTot, n };
}

/**
 * Category effects in log10: each category's mean residual from the curve,
 * winsorized at +-1 dex so one extreme peer cannot dominate, kept only for
 * categories with at least MIN_PEERS traded protocols, shrunk toward zero
 * with SHRINK pseudo-comparables, and clamped to +-0.5 dex. A category with
 * too few peers gets no effect at all — the curve alone prices it, and the
 * row says so ("curve only").
 */
export const CATEGORY_MIN_PEERS = 5;
export const CATEGORY_SHRINK = 4;
export const CATEGORY_WINSOR = 1.0;
export const CATEGORY_CLAMP = 0.5;

export function categoryEffects(
  traded: SnapshotProtocol[],
  fit: CurveFit,
): Map<string, { effect: number; peers: number }> {
  const byCategory = new Map<string, number[]>();
  for (const p of traded) {
    const key = p.category ?? 'Uncategorised';
    const resid = Math.log10(p.mcap_usd as number) - (fit.a + fit.b * Math.log10(p.tvl_usd));
    const winsorized = Math.max(-CATEGORY_WINSOR, Math.min(CATEGORY_WINSOR, resid));
    const list = byCategory.get(key) ?? [];
    list.push(winsorized);
    byCategory.set(key, list);
  }
  const out = new Map<string, { effect: number; peers: number }>();
  for (const [key, list] of byCategory) {
    if (list.length < CATEGORY_MIN_PEERS) continue;
    const mean = list.reduce((s, r) => s + r, 0) / list.length;
    const shrunk = mean * (list.length / (list.length + CATEGORY_SHRINK));
    out.set(key, { effect: Math.max(-CATEGORY_CLAMP, Math.min(CATEGORY_CLAMP, shrunk)), peers: list.length });
  }
  return out;
}

// ------------------------------------------------------------------ factors

/** Growth factor: half the 7-day TVL change, clamped; 1 when unreported. */
export function growthFactor(p: SnapshotProtocol): number {
  if (p.change_7d === null || p.change_7d === undefined) return 1;
  return Math.max(0.6, Math.min(1.5, 1 + 0.5 * (p.change_7d / 100)));
}

/**
 * Maturity factor: 0.70 for a brand-new listing, rising linearly to 1.00 at
 * two years with no token. Unknown age is treated as one year (0.85).
 */
export function maturityFactor(p: SnapshotProtocol, asOf: string): number {
  const days = ageDays(p, asOf) ?? 365;
  return 0.7 + 0.3 * (Math.min(days, 730) / 730);
}

/** Breadth factor: +2% per chain past the first, at most +10%. */
export function breadthFactor(p: SnapshotProtocol): number {
  return 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 5);
}

// ------------------------------------------------------------------ pricing

export interface PricedProtocol {
  protocol: SnapshotProtocol;
  /** The curve's base value before any factor. */
  curveValue: number;
  /** Category effect applied, in log10 (0 when the category has too few peers). */
  categoryEffect: number;
  /** Traded peers behind the category effect (0 when the curve prices alone). */
  categoryPeers: number;
  growth: number;
  maturity: number;
  breadth: number;
  /** Final implied value in whole dollars. */
  implied: number;
  /** P25 of the implied value, from the fitted residuals. */
  low: number;
  /** P75 of the implied value, from the fitted residuals. */
  high: number;
  /** Reference-class launch chance, 0..1. */
  launchChance: number;
  /** Implied value times launch chance. */
  expectedValue: number;
}

export interface ModelContext {
  fit: CurveFit;
  effects: Map<string, { effect: number; peers: number }>;
  /** P25/P75 multipliers from the full model's residuals on traded protocols. */
  lowMult: number;
  highMult: number;
  /** Token rate by age bucket (days): <180, 180-540, 540-1080, >1080. */
  ageRates: number[];
  /** Token rate by TVL bucket: <10M, 10-50M, 50-200M, 200M-1B, >1B. */
  tvlRates: number[];
  /** Overall share of snapshot protocols that record a token. */
  overallRate: number;
  asOf: string;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Build the fitted context once, from the snapshot's traded protocols. */
export function buildContext(snapshot: Snapshot): ModelContext {
  const traded = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const fit = fitCurve(traded);
  const effects = categoryEffects(traded, fit);
  // Residual band of the full model (curve + category effect) on the comps.
  const residuals: number[] = [];
  for (const p of traded) {
    const eff = effects.get(p.category ?? 'Uncategorised');
    const pred =
      Math.pow(10, fit.a + fit.b * Math.log10(p.tvl_usd)) * Math.pow(10, eff ? eff.effect : 0);
    residuals.push(Math.log10((p.mcap_usd as number) / pred));
  }
  residuals.sort((x, y) => x - y);
  const lowMult = Math.pow(10, quantile(residuals, 0.25));
  const highMult = Math.pow(10, quantile(residuals, 0.75));
  // Reference-class launch rates, straight from the snapshot's own record.
  const hasToken = (p: SnapshotProtocol): boolean => p.gecko_id !== null || p.symbol !== null;
  const ageBuckets: SnapshotProtocol[][] = [[], [], [], []];
  const tvlBuckets: SnapshotProtocol[][] = [[], [], [], [], []];
  for (const p of snapshot.protocols) {
    const days = ageDays(p, snapshot.as_of);
    const ai = days === null ? -1 : days < 180 ? 0 : days < 540 ? 1 : days < 1080 ? 2 : 3;
    if (ai >= 0) ageBuckets[ai].push(p);
    const t = p.tvl_usd;
    const ti = t < 1e7 ? 0 : t < 5e7 ? 1 : t < 2e8 ? 2 : t < 1e9 ? 3 : 4;
    tvlBuckets[ti].push(p);
  }
  const rate = (list: SnapshotProtocol[]): number =>
    list.length === 0 ? 0 : list.filter(hasToken).length / list.length;
  const overallRate = rate(snapshot.protocols);
  return {
    fit,
    effects,
    lowMult,
    highMult,
    ageRates: ageBuckets.map(rate),
    tvlRates: tvlBuckets.map(rate),
    overallRate,
    asOf: snapshot.as_of,
  };
}

/**
 * Reference-class launch chance: 60% the token rate of the protocol's age
 * bucket, 40% the token rate of its TVL bucket, clamped to [0.25, 0.80].
 * It is a base rate — the share of snapshot protocols of this age and size
 * that record a token — not a prediction that this protocol will launch.
 */
export function launchChance(p: SnapshotProtocol, ctx: ModelContext): number {
  const days = ageDays(p, ctx.asOf);
  const ageRate =
    days === null ? ctx.overallRate : ctx.ageRates[days < 180 ? 0 : days < 540 ? 1 : days < 1080 ? 2 : 3];
  const t = p.tvl_usd;
  const tvlRate = ctx.tvlRates[t < 1e7 ? 0 : t < 5e7 ? 1 : t < 2e8 ? 2 : t < 1e9 ? 3 : 4];
  return Math.max(0.25, Math.min(0.8, 0.6 * ageRate + 0.4 * tvlRate));
}

/** Price one protocol through the full model. */
export function priceProtocol(p: SnapshotProtocol, ctx: ModelContext): PricedProtocol {
  const curveValue = Math.pow(10, ctx.fit.a + ctx.fit.b * Math.log10(p.tvl_usd));
  const eff = ctx.effects.get(p.category ?? 'Uncategorised');
  const categoryEffect = eff ? eff.effect : 0;
  const categoryPeers = eff ? eff.peers : 0;
  const growth = growthFactor(p);
  const maturity = maturityFactor(p, ctx.asOf);
  const breadth = breadthFactor(p);
  const raw =
    curveValue * Math.pow(10, categoryEffect) * growth * maturity * breadth;
  const implied = Math.max(1, Math.round(raw));
  const chance = launchChance(p, ctx);
  return {
    protocol: p,
    curveValue,
    categoryEffect,
    categoryPeers,
    growth,
    maturity,
    breadth,
    implied,
    low: Math.max(1, Math.round(implied * ctx.lowMult)),
    high: Math.max(1, Math.round(implied * ctx.highMult)),
    launchChance: chance,
    expectedValue: Math.max(1, Math.round(implied * chance)),
  };
}

// ------------------------------------------------------------------ backtest

export interface BacktestResult {
  /** Median leave-one-out miss of the curve model, as a multiple (x3.45). */
  curveMiss: number;
  /** Median leave-one-out miss of the flat global-median baseline. */
  flatMiss: number;
  /** Traded protocols priced blind. */
  n: number;
}

/**
 * Leave-one-out backtest: each traded protocol is priced blind by a curve
 * (and category effects) fitted without it, and the miss is the ratio of the
 * larger to the smaller of predicted and actual market cap. The flat
 * baseline prices every protocol at the global median mcap/TVL of the
 * others. Median miss, not mean: one wild token must not decide it.
 */
export function leaveOneOut(traded: SnapshotProtocol[]): BacktestResult {
  const curveMisses: number[] = [];
  const flatMisses: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const rest = traded.filter((_, j) => j !== i);
    const fit = fitCurve(rest);
    const effects = categoryEffects(rest, fit);
    const p = traded[i];
    const eff = effects.get(p.category ?? 'Uncategorised');
    const pred =
      Math.pow(10, fit.a + fit.b * Math.log10(p.tvl_usd)) * Math.pow(10, eff ? eff.effect : 0);
    const actual = p.mcap_usd as number;
    curveMisses.push(Math.max(actual, pred) / Math.min(actual, pred));
    const ratios = rest.map((q) => (q.mcap_usd as number) / q.tvl_usd).sort((x, y) => x - y);
    const median = quantile(ratios, 0.5);
    const flatPred = median * p.tvl_usd;
    flatMisses.push(Math.max(actual, flatPred) / Math.min(actual, flatPred));
  }
  curveMisses.sort((x, y) => x - y);
  flatMisses.sort((x, y) => x - y);
  return {
    curveMiss: quantile(curveMisses, 0.5),
    flatMiss: quantile(flatMisses, 0.5),
    n: traded.length,
  };
}

// ------------------------------------------------------------------ farm economics

/** Share of an implied launch value assumed to reach farmers. Printed on the board. */
export const AIRDROP_SHARE = 0.075;

/** Typical cost of one transaction per chain, USD. An estimate, printed as one. */
export const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 15.0,
  Arbitrum: 1.2,
  Base: 0.5,
  Solana: 0.08,
  Binance: 0.35,
  Avalanche: 0.7,
  Polygon: 0.12,
  Optimism: 0.7,
  Gnosis: 0.15,
  'Hyperliquid L1': 0.08,
  Monad: 0.08,
  Plasma: 0.08,
  Sui: 0.05,
  Aptos: 0.05,
  Sei: 0.05,
  Berachain: 0.1,
  Sonic: 0.1,
  Linea: 0.3,
  Scroll: 0.3,
  zkSync: 0.4,
  Starknet: 0.4,
  Mantle: 0.2,
  Blast: 0.3,
  Mode: 0.1,
  Fraxtal: 0.2,
  Celo: 0.05,
  Fantom: 0.1,
  Cronos: 0.1,
  Kava: 0.1,
  Tron: 0.5,
  TON: 0.1,
  Near: 0.02,
  Cosmos: 0.05,
  Osmosis: 0.05,
  Injective: 0.02,
  'Robinhood Chain': 0.05,
  Ink: 0.1,
  Unichain: 0.1,
  Abstract: 0.1,
  MegaETH: 0.05,
  HyperEVM: 0.08,
  'B2 Network': 0.1,
  BSquared: 0.1,
  Arc: 0.5,
  'Corn': 0.1,
  'Hemi': 0.1,
  'X Layer': 0.2,
  'Soneium': 0.1,
  'World Chain': 0.1,
  'BNB Chain': 0.35,
};
export const DEFAULT_GAS_USD = 1.5;
/** Transactions a farm plan is costed for. */
export const PLAN_TRANSACTIONS = 4;

export type FarmVerdict = 'PAYS OFF' | 'MARGINAL' | 'UNDERWATER';

export interface FarmEconomics {
  /** Expected airdrop dollars for $1,000 farmed. */
  airdropPer1k: number;
  /** Estimated total gas for the plan, USD. */
  gasUsd: number;
  /** Net dollars at $1,000 farmed: airdrop minus gas. */
  netAt1k: number;
  verdict: FarmVerdict;
  /** Suggested position size, USD, by TVL tier. */
  ticketUsd: number;
  /** Suggested hold, days, by TVL tier. */
  holdDays: number;
  /** Primary chain the gas estimate is costed on. */
  gasChain: string;
}

export function farmEconomics(p: SnapshotProtocol, implied: number): FarmEconomics {
  const airdropPer1k = (1000 / p.tvl_usd) * AIRDROP_SHARE * implied;
  const gasChain = p.chains.length > 0 ? p.chains[0] : 'Ethereum';
  const gasUsd = PLAN_TRANSACTIONS * (CHAIN_GAS_USD[gasChain] ?? DEFAULT_GAS_USD);
  const netAt1k = airdropPer1k - gasUsd;
  const verdict: FarmVerdict = netAt1k > 5 ? 'PAYS OFF' : netAt1k >= -5 ? 'MARGINAL' : 'UNDERWATER';
  const ticketUsd = p.tvl_usd <= 5e7 ? 50 : p.tvl_usd <= 5e8 ? 150 : 300;
  const holdDays = p.tvl_usd <= 5e7 ? 30 : p.tvl_usd <= 5e8 ? 45 : 60;
  return { airdropPer1k, gasUsd, netAt1k, verdict, ticketUsd, holdDays, gasChain };
}

// ------------------------------------------------------------------ farm plans

function money(n: number): string {
  if (Number.isInteger(n)) return `$${n.toLocaleString('en-US')}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Six concrete farm steps for a row, shaped by the protocol's category and
 * chains, costed with the ticket and gas above, and closed with exit
 * criteria. Every step is 20-600 characters once trimmed (the gate's rule).
 */
export function farmSteps(p: SnapshotProtocol, econ: FarmEconomics): string[] {
  const chain = econ.gasChain;
  const ticket = money(econ.ticketUsd);
  const gas = money(econ.gasUsd);
  const hold = econ.holdDays;
  const name = p.name;
  const cat = p.category ?? 'protocol';
  const enter: Record<string, string> = {
    Lending: `Supply ${ticket} of a major asset to ${name} on ${chain} as a lender, then borrow a small amount against it so the position counts as active use.`,
    Dexs: `Add ${ticket} of liquidity to ${name}'s deepest pool on ${chain} and stake the LP receipt if the app offers a gauge or farm.`,
    Yield: `Deposit ${ticket} into ${name}'s highest-TVL vault on ${chain} and leave the receipt token staked rather than sitting idle in the wallet.`,
    'Risk Curators': `Deposit ${ticket} into ${name}'s curated vault on ${chain}; a curator vault is the product here, so the deposit itself is the farm.`,
    RWA: `Buy ${ticket} of ${name}'s tokenised real-world product on ${chain} and hold the receipt; real-world positions are usually scored by time held.`,
    Derivatives: `Open a small ${ticket} position on ${name} on ${chain} with low leverage, and keep margin above the liquidation buffer for the whole hold.`,
    CDP: `Lock ${ticket} of collateral in ${name} on ${chain} and mint a modest amount of its stable asset, staying well above the minimum collateral ratio.`,
    'Basis Trading': `Deposit ${ticket} into ${name}'s basis vault on ${chain}; the strategy earns the funding-rate spread, so the deposit is the whole position.`,
    'Yield Aggregator': `Deposit ${ticket} into ${name}'s auto-compounding vault on ${chain} and let the harvester run instead of claiming by hand.`,
    'Liquid Staking': `Stake ${ticket} of the native asset through ${name} on ${chain} and keep the liquid staking receipt in the wallet for the hold.`,
    Bridge: `Bridge ${ticket} through ${name} to ${chain} and back once, then keep a small balance routed through it weekly so the activity is not a single event.`,
    Chain: `Bridge ${ticket} to ${name}'s chain, swap a little on its native DEX, and use one native app so the wallet reads as a real user.`,
    'Prediction Market': `Place a ${ticket} position on ${name}'s most liquid market on ${chain} and hold it to resolution rather than trading in and out.`,
    'Onchain Capital Allocator': `Allocate ${ticket} through ${name} on ${chain} into its flagship strategy and leave it deployed for the full hold.`,
    'Staking Pool': `Stake ${ticket} in ${name}'s pool on ${chain} and keep the position staked; unstaking early usually forfeits the points.`,
    'Cross Chain': `Move ${ticket} across chains with ${name}, then use the destination chain's app once so the transfer is tied to real activity.`,
    Indexes: `Buy ${ticket} of ${name}'s index token on ${chain} and hold it; index products are scored on holding, not on trading.`,
    'Options': `Buy a small ${ticket} options position on ${name} on ${chain} and hold it to expiry; keep the size small enough that a total loss is acceptable.`,
    'Leveraged Farming': `Open a ${ticket} leveraged position on ${name} on ${chain} at the lowest leverage the app allows and monitor the health factor weekly.`,
    'Algo-Stables': `Mint or buy ${ticket} of ${name}'s stable asset on ${chain} and provide it as liquidity where the app rewards it.`,
    'Reserve Currency': `Bond or stake ${ticket} with ${name} on ${chain} and hold the receipt for the full period; early exits usually pay a penalty.`,
    'Services': `Pay for ${name}'s service on ${chain} with a ${ticket} budget and keep the subscription or credits active for the hold.`,
    'SoFi': `Create an account on ${name}, fund it with ${ticket} on ${chain}, and use the social or creator feature at least once a week.`,
    'Gaming': `Fund a ${name} account with ${ticket} on ${chain} and play or hold the in-game asset regularly through the hold.`,
    'NFT Marketplace': `List or buy one item on ${name} on ${chain} with a ${ticket} budget and keep the wallet active on the marketplace weekly.`,
    'Launchpad': `Stake ${ticket} with ${name} on ${chain} to qualify for allocations and join at least one sale during the hold.`,
    'Oracle': `Stake ${ticket} with ${name} on ${chain} if it offers staking, or run a light node; otherwise hold the position and follow its governance.`,
    'Privacy': `Deposit ${ticket} through ${name}'s private pool on ${chain} and leave it shielded for the hold; note the withdrawal delay before entering.`,
    'Restaking': `Restake ${ticket} through ${name} on ${chain} and keep the position restaked; slashing and withdrawal queues apply, so size it small.`,
    'Liquid Restaking': `Deposit ${ticket} into ${name}'s liquid restaking token on ${chain} and hold the receipt rather than selling it.`,
    'DEX Aggregator': `Route a ${ticket} swap through ${name} on ${chain} once a week instead of swapping directly, so the volume is tied to the aggregator.`,
    'AI Agents': `Fund a ${name} agent wallet with ${ticket} on ${chain} and let the agent run its strategy for the hold, checking its log weekly.`,
    'Payments': `Pay ${ticket} through ${name} on ${chain} for a real purchase or transfer, then repeat a smaller payment weekly.`,
    'Collateralized Debt': `Lock ${ticket} of collateral in ${name} on ${chain} and draw a modest loan, staying well above the liquidation ratio.`,
  };
  const enterStep =
    enter[cat] ??
    `Use ${name} on ${chain} with ${ticket}: deposit or buy into its main product and keep the position open for the hold.`;
  const steps = [
    `Set up a fresh wallet for farming, fund it with ${ticket} plus about ${gas} for gas on ${chain}, and open ${name} only from its official site or app.`,
    enterStep,
    `Deepen the position once in the first week: add a second interaction of the same kind (a second deposit, a second pool, or a vote) so the wallet shows repeat use, not a single touch.`,
    `Stay active weekly for ${hold} days: check the position, claim or restake any rewards, and answer any governance or quest prompt the app surfaces.`,
    `Track the position in a simple log: entry date, amount, chain, and any points or receipt balance, so the exit decision is made from records, not memory.`,
    `Exit when one of these is true: the token launches and the airdrop is claimable (claim, then sell half and keep half), the ${hold}-day hold ends with no launch news (withdraw and move on), or the position falls 20% (cut it and stop).`,
  ];
  return steps;
}

// ------------------------------------------------------------------ the board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  tvl_usd: number;
  category: string | null;
  chains: string[];
  change_7d: number | null;
  age_days: number | null;
  curve_multiple: number;
  category_effect: number;
  category_peers: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  low_usd: number;
  high_usd: number;
  launch_chance: number;
  expected_value_usd: number;
  airdrop_per_1k_usd: number;
  gas_usd: number;
  net_at_1k_usd: number;
  verdict: FarmVerdict;
  ticket_usd: number;
  hold_days: number;
  gas_chain: string;
  watchlist: boolean;
}

export interface FunnelCounts {
  tracked: number;
  withToken: number;
  noToken: number;
  board: number;
  watchlist: number;
  early: number;
  setAside: number;
  setAsideReasons: Array<{ reason: string; count: number }>;
}

/** Build the ranked board: every pre-token, rule-eligible protocol, by implied value. */
export function buildBoard(snapshot: Snapshot, ctx: ModelContext): { rows: BoardRow[]; funnel: FunnelCounts } {
  const watch = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  const setAsideReasons = new Map<string, number>();
  let withToken = 0;
  let noToken = 0;
  for (const p of snapshot.protocols) {
    if (!recordsNoToken(p)) {
      withToken++;
      continue;
    }
    noToken++;
    const reason = setAsideReason(p);
    if (reason !== null) {
      setAsideReasons.set(reason, (setAsideReasons.get(reason) ?? 0) + 1);
      continue;
    }
    const priced = priceProtocol(p, ctx);
    const econ = farmEconomics(p, priced.implied);
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: priced.implied,
      farm_steps: farmSteps(p, econ),
      tvl_usd: p.tvl_usd,
      category: p.category,
      chains: p.chains,
      change_7d: p.change_7d,
      age_days: ageDays(p, snapshot.as_of),
      curve_multiple: priced.curveValue / p.tvl_usd,
      category_effect: priced.categoryEffect,
      category_peers: priced.categoryPeers,
      growth_factor: priced.growth,
      maturity_factor: priced.maturity,
      breadth_factor: priced.breadth,
      low_usd: priced.low,
      high_usd: priced.high,
      launch_chance: priced.launchChance,
      expected_value_usd: priced.expectedValue,
      airdrop_per_1k_usd: econ.airdropPer1k,
      gas_usd: econ.gasUsd,
      net_at_1k_usd: econ.netAt1k,
      verdict: econ.verdict,
      ticket_usd: econ.ticketUsd,
      hold_days: econ.holdDays,
      gas_chain: econ.gasChain,
      watchlist: watch.has(p.slug),
    });
  }
  // Rank by implied value, ties broken by TVL then slug so the order is total.
  rows.sort((x, y) => {
    if (y.implied_value_usd !== x.implied_value_usd) return y.implied_value_usd - x.implied_value_usd;
    if (y.tvl_usd !== x.tvl_usd) return y.tvl_usd - x.tvl_usd;
    return x.slug < y.slug ? -1 : 1;
  });
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  const reasons = [...setAsideReasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((x, y) => y.count - x.count || (x.reason < y.reason ? -1 : 1));
  const funnel: FunnelCounts = {
    tracked: snapshot.protocols.length,
    withToken,
    noToken,
    board: rows.length,
    watchlist: rows.filter((r) => r.watchlist).length,
    early: rows.filter((r) => !r.watchlist).length,
    setAside: reasons.reduce((s, r) => s + r.count, 0),
    setAsideReasons: reasons,
  };
  return { rows, funnel };
}
