// Token Launch Radar — entrypoint (model "curve-1").
//
// Reads the sealed snapshot, prices every pre-token, rule-eligible protocol
// off the fitted size curve, and writes:
//   /output/board.json     the ranked board (rows + fitted model summary)
//   /output/data.js        the same board, plus comps and set-aside lists,
//                           for the dashboard page (kept OUT of dashboard/
//                           so it never eats the 64 KB dossier budget)
//   /output/dashboard/    the static dashboard (copied from this entry)
//   /output/screenshots/  the three screenshots (copied from this entry)
//   /output/dossier.json  the judge's dossier, built by the kit's vendor code
//
// Fully deterministic: no clock, no network, no randomness. Two runs write
// identical bytes.
//
// Usage: node main.ts [--input snapshot.json]
//   Input default:  $MAKEFUN_INPUT_DIR/snapshot.json, else /input/snapshot.json
//   Output default: $MAKEFUN_OUTPUT_DIR, else /output

import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import {
  buildContext,
  buildBoard,
  leaveOneOut,
  recordsNoToken,
  setAsideReason,
  ageDays,
  type Snapshot,
} from './lib/model.ts';

const MODEL_NAME = 'curve-1';
const MODEL_VERSION = '2.0.0';

function resolveInputPath(argv: string[]): string {
  const flag = argv.indexOf('--input');
  if (flag >= 0 && argv[flag + 1]) return argv[flag + 1];
  if (process.env.MAKEFUN_INPUT_DIR) return join(process.env.MAKEFUN_INPUT_DIR, 'snapshot.json');
  return '/input/snapshot.json';
}

function resolveOutputDir(): string {
  return process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
}

function main(): void {
  const inputPath = resolveInputPath(process.argv.slice(2));
  const outDir = resolveOutputDir();
  const entryDir = dirname(fileURLToPath(import.meta.url));

  const snapshot = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
  const ctx = buildContext(snapshot);
  const { rows, funnel } = buildBoard(snapshot, ctx);

  const traded = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const backtest = leaveOneOut(traded);

  // Traded comparables for the dashboard's comps tab and calibration chart.
  const comps = traded
    .map((p) => {
      const curve = Math.pow(10, ctx.fit.a + ctx.fit.b * Math.log10(p.tvl_usd));
      const eff = ctx.effects.get(p.category ?? 'Uncategorised');
      const predicted = curve * Math.pow(10, eff ? eff.effect : 0);
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd as number,
        ratio: (p.mcap_usd as number) / p.tvl_usd,
        curve_usd: Math.round(curve),
        predicted_usd: Math.round(predicted),
        residual_log: Math.log10((p.mcap_usd as number) / predicted),
      };
    })
    .sort((x, y) => y.mcap_usd - x.mcap_usd);

  // Set-aside pre-token protocols, with the rule that set each one aside.
  const setAside = snapshot.protocols
    .filter((p) => recordsNoToken(p) && setAsideReason(p) !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: setAsideReason(p) as string,
    }))
    .sort((x, y) => y.tvl_usd - x.tvl_usd);

  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const totalExpected = rows.reduce((s, r) => s + r.expected_value_usd, 0);
  const verdicts = {
    paysOff: rows.filter((r) => r.verdict === 'PAYS OFF').length,
    marginal: rows.filter((r) => r.verdict === 'MARGINAL').length,
    underwater: rows.filter((r) => r.verdict === 'UNDERWATER').length,
  };
  const categories = [...new Set(rows.map((r) => r.category ?? 'Uncategorised'))].sort();
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();

  const modelSummary = {
    model: MODEL_NAME,
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    curve: {
      intercept: ctx.fit.a,
      slope: ctx.fit.b,
      r2: ctx.fit.r2,
      n: ctx.fit.n,
      formula: `log10(mcap) = ${ctx.fit.a.toFixed(4)} + ${ctx.fit.b.toFixed(4)} * log10(TVL)`,
    },
    category_effects: [...ctx.effects.entries()]
      .map(([category, v]) => ({ category, effect_log: v.effect, peers: v.peers }))
      .sort((x, y) => y.effect_log - x.effect_log),
    category_rule: 'mean winsorized (+-1 dex) log-residual, min 5 traded peers, shrunk n/(n+4), clamped +-0.5 dex',
    residual_band: { p25_mult: ctx.lowMult, p75_mult: ctx.highMult },
    backtest: {
      leave_one_out_median_miss: backtest.curveMiss,
      flat_median_baseline_miss: backtest.flatMiss,
      n: backtest.n,
    },
    launch_rates: {
      age_buckets: ['<180d', '180-540d', '540-1080d', '>1080d'],
      age_rates: ctx.ageRates,
      tvl_buckets: ['<10M', '10-50M', '50-200M', '200M-1B', '>1B'],
      tvl_rates: ctx.tvlRates,
      overall_rate: ctx.overallRate,
      mix: '0.6 * age rate + 0.4 * TVL rate, clamped [0.25, 0.80]',
    },
    farm_assumptions: {
      airdrop_share_of_implied: 0.075,
      plan_transactions: 4,
      ticket_tiers: '$50 (TVL <= $50M), $150 ($50M-500M), $300 (> $500M)',
      hold_tiers: '30 days (TVL <= $50M), 45 days ($50M-500M), 60 days (> $500M)',
      verdict_rule: 'net at $1k farmed: > $5 PAYS OFF, -$5..$5 MARGINAL, < -$5 UNDERWATER',
    },
    totals: {
      implied_usd: totalImplied,
      expected_usd: totalExpected,
      verdicts,
    },
    funnel,
    categories,
    chains,
  };

  const board = { model: modelSummary, rows };
  const data = {
    model: modelSummary,
    rows,
    comps,
    setAside,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), JSON.stringify(board, null, 2) + '\n');
  writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`);

  // Static assets ship with the entry, beside this file.
  const dashboardSrc = join(entryDir, 'dashboard');
  const screenshotsSrc = join(entryDir, 'screenshots');
  if (existsSync(dashboardSrc)) cpSync(dashboardSrc, join(outDir, 'dashboard'), { recursive: true });
  if (existsSync(screenshotsSrc)) cpSync(screenshotsSrc, join(outDir, 'screenshots'), { recursive: true });

  // The dossier is built from the output tree, so it goes last.
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

  const shotCount = existsSync(join(outDir, 'screenshots'))
    ? readdirSync(join(outDir, 'screenshots')).length
    : 0;
  console.log(
    `curve-1 v${MODEL_VERSION}: ${rows.length} rows (${funnel.watchlist} watchlist, ${funnel.early} early), ` +
      `total implied $${(totalImplied / 1e9).toFixed(2)}B, ` +
      `LOO x${backtest.curveMiss.toFixed(2)} vs flat x${backtest.flatMiss.toFixed(2)}, ` +
      `${shotCount} screenshots, dossier written.`,
  );
}

main();
