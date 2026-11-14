// main.ts — entrypoint: snapshot in, board + data.js + dashboard + screenshots + dossier out.
//
// Node 22, standard library only. It runs in a fresh container with no network, a
// read-only repository and a writable output directory:
//
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input kit/token-radar-01-kit/input/snapshot.json
//
// The input flag is optional: inside the grading container the snapshot sits at
// /input/snapshot.json and the output at /output (or MAKEFUN_OUTPUT_DIR). The run is
// deterministic: the same snapshot bytes always write the same output bytes, because
// nothing here reads the clock, the environment or a random source.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, buildLive, type Snapshot } from './lib/model.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

const inputPath = argValue('--input') ?? '/input/snapshot.json';
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snapshot = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const { rows, table } = buildBoard(snapshot);
const live = buildLive(snapshot, table);

// The screenshots are taken from a built output, so the entry ships them: refuse to
// run until all three are present, rather than writing a board with no pictures.
const shotsDir = join(ROOT, 'screenshots');
const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((f) => f.toLowerCase().endsWith('.png'))
  : [];
if (shots.length < 3) {
  throw new Error(`screenshots/ holds ${shots.length} images; the entry needs 3 before it runs`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(join(outDir, 'dashboard'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });

// The ranked board: every launch candidate, its model inputs and its farm plan.
writeFileSync(
  join(outDir, 'board.json'),
  JSON.stringify({ as_of: snapshot.as_of, floor_usd: snapshot.floor_usd, rows }, null, 2) + '\n',
);

// The dashboard's data, beside the page: the board rows, the live rows for the
// Live tab, and the peer-multiples calibration the model panel shows.
const data = {
  asOf: snapshot.as_of,
  floorUsd: snapshot.floor_usd,
  globalMedian: table.global,
  peers: table.byCategory,
  rows,
  live,
};
writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`);

cpSync(join(ROOT, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

// The dossier the judge reads: the screenshots plus the dashboard's source, as the
// vendored library writes them.
writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

console.log(
  `token-radar: ${rows.length} board rows, ${live.length} live rows, ` +
    `${shots.length} screenshots, dossier written to ${outDir}`,
);
