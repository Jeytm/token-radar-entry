// The token radar: a make.fun token-radar-01 entry (Node 22, erasable TypeScript, standard library only).
//
// It reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), scores every pre-token
// protocol with the model in lib/model.ts, writes the ranked board to <output>/board.json, copies this
// repository's dashboard/ and screenshots/ into <output>, and writes <output>/dossier.json with
// buildDossier from vendor/makefun-board.ts — the same library the scorer runs, so the dossier matches
// byte for byte. The dossier must be written LAST: it reads the dashboard and screenshots as copied.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p /tmp/radarout2 && node main.ts --input <kit>/input --output /tmp/radarout2

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard } from './lib/model.ts';
import type { Snapshot } from './lib/snapshot.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (RULES.txt, gate board_file and dossier_matches): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

// ---------------------------------------------------------------- input

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}

function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('the snapshot is not a snapshot: as_of, protocols and watchlist are required');
  }
  return raw;
}

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const board = buildBoard(snapshot);
const issue = boardIssue(board);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- output

const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
mkdirSync(out, { recursive: true });
mkdirSync(join(out, 'dashboard'), { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ as_of: snapshot.as_of, generated: new Date().toISOString(), rows: board }, null, 2)}\n`);
writeFileSync(join(out, 'dashboard', 'board-data.js'), `// Written by main.ts from the board below: the page's only input.\nwindow.BOARD = ${JSON.stringify({ as_of: snapshot.as_of, source: snapshot.source, rows: board })};\n`);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied.sort();
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last, from the output directory as handed in: the scorer rebuilds it from the
// same directory and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} pre-token rows scored\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'dashboard')} (${shots.length} screenshots copied) and ${join(out, 'dossier.json')}\n`,
);
