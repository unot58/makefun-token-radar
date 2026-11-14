// lib/model.ts — the radar-2 model, the board builder and the farm-plan generator.
//
// Everything here is computed from the sealed snapshot at run time: no protocol name,
// multiple or value is typed in. The dashboard's detail view re-derives a row's implied
// value from the same formula, so the number on the page is the number in board.json.
//
// The model prices each protocol at what the market already pays for the same kind of
// business: the median market-cap-per-dollar-of-TVL of its traded peers, taken from the
// snapshot itself. A category with fewer than three traded peers falls back to the
// global median, so no category is priced from one or two noisy names.

export interface Protocol {
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
  protocols: Protocol[];
  watchlist: string[];
}

/** The peer-multiples calibration, computed from the snapshot's traded protocols. */
export interface PeerTable {
  /** Category -> the multiple the board uses, with its peer count. Only categories with >= 3 traded peers. */
  byCategory: Record<string, { multiple: number; peers: number }>;
  /** The median mcap/TVL over every traded protocol; used when a category has too few peers. */
  global: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  age_known: boolean;
  peer_multiple: number;
  implied_value_usd: number;
  watchlist: boolean;
  live: boolean;
  mcap_usd: number | null;
  farm_steps: string[];
}

export function median(values: number[]): number {
  const xs = [...values].sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) throw new Error('median of no values');
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/**
 * The peer multiples of the snapshot. A protocol counts as a traded peer when DefiLlama
 * records a positive market cap for it (a zero or negative market cap is no market at
 * all). Each category's multiple is the median mcap/TVL of its peers, clamped to
 * [0.05, 1.50] and rounded to 4 decimals before anything uses it, so the board, the
 * peer table and the page's recompute all carry the same number.
 */
export function peerMultiples(protocols: Protocol[]): PeerTable {
  const peers = protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const byCategory = new Map<string, number[]>();
  for (const p of peers) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }
  const global = round4(clamp(median(peers.map((p) => p.mcap_usd! / p.tvl_usd)), 0.05, 1.5));
  const table: Record<string, { multiple: number; peers: number }> = {};
  for (const [cat, ratios] of [...byCategory.entries()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (ratios.length < 3) continue;
    table[cat] = { multiple: round4(clamp(median(ratios), 0.05, 1.5)), peers: ratios.length };
  }
  return { byCategory: table, global };
}

/** The multiple a protocol is priced at: its category's, or the global one when the category has too few peers. */
export function multipleFor(category: string | null, table: PeerTable): number {
  const key = category ?? 'Uncategorised';
  return table.byCategory[key]?.multiple ?? table.global;
}

/** Whole days between the snapshot date and the day DefiLlama began tracking the protocol; 365 when it reports none. */
export function ageDays(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 365;
  const [y, m, d] = asOf.split('-').map(Number);
  const [ly, lm, ld] = listedAt.split('-').map(Number);
  const ms = Date.UTC(y!, m! - 1, d!) - Date.UTC(ly!, lm! - 1, ld!);
  return Math.max(0, Math.round(ms / 86400000));
}

/** Growth: half the 7-day TVL change counts, clamped to [-60, +120]%; no report counts as flat. */
export function growthFactor(change7d: number | null): number {
  return 1 + clamp(change7d ?? 0, -60, 120) / 100 * 0.5;
}

/** Maturity: a protocol earns from 0.70 at launch to 1.00 after two years of running with no token. */
export function maturityFactor(age: number): number {
  return 0.7 + Math.min(age, 730) / 730 * 0.3;
}

/** Breadth: 2% per extra chain, up to ten extra chains. */
export function breadthFactor(chains: string[]): number {
  return 1 + 0.02 * Math.min(Math.max(chains.length - 1, 0), 10);
}

/**
 * The implied value: TVL x peer multiple x growth x maturity x breadth, rounded to whole
 * dollars. Returns the value with the age and the multiple it used, so callers store the
 * same inputs the page recomputes from.
 */
export function impliedValue(
  p: Protocol,
  table: PeerTable,
  asOf: string,
): { value: number; age: number; multiple: number } {
  const multiple = multipleFor(p.category, table);
  const age = ageDays(p.listed_at, asOf);
  const value = Math.round(
    p.tvl_usd * multiple * growthFactor(p.change_7d) * maturityFactor(age) * breadthFactor(p.chains),
  );
  return { value, age, multiple };
}

// ---------------------------------------------------------------- eligibility

/**
 * The watchlist's exclusion rule, applied board-wide: a launch candidate records no
 * token and is not a wrapped, staked or bridged product of one that trades. Categories
 * that are themselves such a product are out; so are versioned names (a second copy of
 * an existing protocol), names carrying a receipt word, and names that begin with an
 * exchange's name. The rule is the same one the house used for the watchlist, minus the
 * parent-protocol check the snapshot does not carry.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const RECEIPT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

export function isLaunchCandidate(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (RECEIPT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

function toRow(
  p: Protocol,
  rank: number,
  value: number,
  age: number,
  multiple: number,
  watchlist: boolean,
  live: boolean,
): BoardRow {
  return {
    slug: p.slug,
    name: p.name,
    rank,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    age_days: age,
    age_known: p.listed_at !== null,
    peer_multiple: multiple,
    implied_value_usd: value,
    watchlist,
    live,
    mcap_usd: p.mcap_usd,
    farm_steps: farmSteps(p, age),
  };
}

/** The board: every launch candidate in the snapshot, ranked by implied value. */
export function buildBoard(snapshot: Snapshot): { rows: BoardRow[]; table: PeerTable } {
  const table = peerMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isLaunchCandidate)
    .map((p) => {
      const { value, age, multiple } = impliedValue(p, table, snapshot.as_of);
      return { p, value, age, multiple };
    })
    .sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const rows = scored.map((s, i) =>
    toRow(s.p, i + 1, s.value, s.age, s.multiple, watchlist.has(s.p.slug), false),
  );
  return { rows, table };
}

/**
 * The live side of the radar: every protocol whose token already trades, priced by the
 * same model. The dashboard's Live tab shows these for comparison, so a reader can see
 * what the market actually pays against what a launch is priced at. They never enter
 * board.json.
 */
export function buildLive(snapshot: Snapshot, table: PeerTable): BoardRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .map((p) => {
      const { value, age, multiple } = impliedValue(p, table, snapshot.as_of);
      return { p, value, age, multiple };
    })
    .sort((a, b) => b.value - a.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .map((s, i) => toRow(s.p, i + 1, s.value, s.age, s.multiple, false, true));
}

// ---------------------------------------------------------------- farm sizing

/** The capital a farm plan asks for, by the protocol's TVL tier. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 250;
  if (tvlUsd >= 500_000_000) return 200;
  if (tvlUsd >= 100_000_000) return 150;
  if (tvlUsd >= 50_000_000) return 100;
  return 50;
}

/** How long a plan holds: a month for a young protocol, two for one that has run two years. */
export function holdDays(age: number): number {
  if (age >= 730) return 60;
  if (age >= 365) return 45;
  return 30;
}

// ---------------------------------------------------------------- farm plans

/**
 * What a reader actually does with a protocol, by its category. Each clause is the
 * protocol's own business in plain words: lend where it lends, add liquidity where it
 * trades, mint where it mints. Categories the map does not name fall back to a generic
 * clause that still names the category, so no row ever gets a plan for another
 * protocol's business.
 */
function actionClause(category: string | null, name: string, chain: string, capital: number): string {
  switch (category) {
    case 'Lending':
      return `Lend $${capital} of USDC in ${name}'s market on ${chain} and keep the loan open`;
    case 'Dexs':
      return `Add $${capital} of liquidity to ${name}'s largest pool on ${chain} and hold the LP tokens`;
    case 'Yield':
      return `Deposit $${capital} into ${name}'s yield vault on ${chain} and let the position compound`;
    case 'RWA':
      return `Mint $${capital} of ${name}'s tokenized asset on ${chain} and hold it in your wallet`;
    case 'Basis Trading':
      return `Deposit $${capital} into ${name}'s basis vault on ${chain} and keep the position open`;
    case 'CDP':
      return `Lock $${capital} of collateral in ${name}'s vault on ${chain} and mint stablecoins against it`;
    case 'CDP Manager':
      return `Manage a $${capital} CDP position with ${name} on ${chain} and keep it healthy`;
    case 'Cross Chain Bridge':
      return `Bridge $${capital} to another chain with ${name} on ${chain} and keep the receipt`;
    case 'Privacy':
      return `Route $${capital} through ${name}'s privacy pool on ${chain} and keep the receipt`;
    case 'Risk Curators':
      return `Deposit $${capital} into a vault curated by ${name} on ${chain} and follow its allocation`;
    case 'Onchain Capital Allocator':
      return `Allocate $${capital} through ${name} on ${chain} into its managed strategy`;
    case 'Derivatives':
      return `Open a $${capital} hedged position on ${name} on ${chain} and keep margin above the minimum`;
    case 'Interest Rate Derivatives':
      return `Open a $${capital} rate position on ${name} on ${chain} and track the rate`;
    case 'Yield Aggregator':
      return `Deposit $${capital} into ${name}'s auto-compounding vault on ${chain}`;
    case 'Liquidity Manager':
      return `Deposit $${capital} into ${name}'s managed liquidity position on ${chain}`;
    case 'Leveraged Farming':
      return `Open a $${capital} leveraged farm on ${name} on ${chain} and watch the liquidation level`;
    case 'Restaking':
      return `Restake $${capital} through ${name} on ${chain} and keep the position active`;
    case 'Staking Pool':
      return `Stake $${capital} in ${name}'s pool on ${chain} and keep the stake running`;
    case 'Indexes':
      return `Buy $${capital} of ${name}'s index on ${chain} and hold it in your wallet`;
    case 'Farm':
      return `Stake $${capital} in ${name}'s farm on ${chain} and harvest the rewards weekly`;
    case 'Launchpad':
      return `Join ${name}'s launch on ${chain} with $${capital} and complete every task it lists`;
    case 'Prediction Market':
      return `Place $${capital} of predictions through ${name} on ${chain} and track the outcomes`;
    case 'Insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active`;
    case 'Payments':
      return `Pay $${capital} through ${name} on ${chain} and keep the transaction receipt`;
    case 'CeDeFi':
      return `Deposit $${capital} into ${name}'s CeDeFi vault on ${chain} and keep the position open`;
    case 'Anchor BTC':
      return `Deposit $${capital} of BTC-backed collateral with ${name} on ${chain}`;
    case 'Decentralized BTC':
      return `Mint $${capital} of ${name}'s BTC-backed asset on ${chain} and hold it`;
    case 'Dual-Token Stablecoin':
      return `Mint $${capital} of ${name}'s stablecoin on ${chain} and hold both of its tokens`;
    case 'Stablecoin Wrapper':
      return `Wrap $${capital} into ${name}'s stablecoin wrapper on ${chain}`;
    case 'Uncollateralized Lending':
      return `Lend $${capital} through ${name}'s credit market on ${chain}`;
    case 'OTC Marketplace':
      return `Trade $${capital} over the counter through ${name} on ${chain}`;
    case 'Governance Incentives':
      return `Lock $${capital} with ${name} on ${chain} to earn its governance incentives`;
    case 'Crypto Card Issuer':
      return `Load $${capital} onto a card from ${name} on ${chain} and spend from it`;
    case 'Collateral Markets':
      return `Post $${capital} of collateral in ${name}'s market on ${chain}`;
    case 'Chain':
      return `Use $${capital} of ${name}'s chain on ${chain} for a real transaction and keep the receipt`;
    default:
      return `Use $${capital} of ${name}'s ${category ?? 'protocol'} product on ${chain} and keep the position active`;
  }
}

/**
 * Six concrete steps per protocol, each with what it costs and how long it takes:
 * set up a fresh wallet, use the protocol, use it again a week later, use it on a
 * second chain (or check in weekly when it runs on one chain only), hold for the
 * age-set period, then claim — only from the protocol's own published link, and never
 * by paying anyone. The dashboard shows these same steps, read from board.json's data,
 * never a second derivation.
 */
export function farmSteps(p: Protocol, age: number): string[] {
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDays(age);
  const chain = p.chains[0] ?? 'Ethereum';
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const half = Math.max(10, Math.round(capital / 2));
  const action = actionClause(p.category, p.name, chain, capital);
  return [
    `Create a fresh wallet just for ${p.name}; write the seed phrase on paper and store it offline. Fund it with $${capital} in stablecoins plus $5 for gas. (15 minutes, about $1 in gas.)`,
    `${action}. Do it from the fresh wallet so the activity is tied to one address. (25 minutes, about $2 in gas.)`,
    `Come back a week later and repeat the same move with another $${half}, so your history shows repeat use instead of a single visit. (20 minutes, about $2 in gas.)`,
    second !== null
      ? `Do the same on ${second}: move $${half} of your position to ${p.name} on ${second} so the protocol sees you on two chains. (25 minutes, about $3 in gas.)`
      : `Check the position once a week and add $${half} whenever ${p.name} opens a new pool or points campaign. (10 minutes a week, about $1 in gas each time.)`,
    `Leave the position untouched for ${hold} days; a steady, long-running user reads better than a one-day visitor. (No further cost; ${hold} days.)`,
    `Watch ${p.name}'s own announcements for a token or points claim; claim only from the link the protocol itself publishes, and never pay anyone to claim for you. (10 minutes, gas only.)`,
  ];
}
