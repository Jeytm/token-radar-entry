// The token radar model: one deterministic function from the sealed snapshot to the ranked board.
//
// A protocol is PRE-TOKEN when its snapshot entry records no token: mcap_usd, gecko_id and symbol are
// all null. Pre-token protocols are the radar's subject; a protocol that already trades is not.
//
// House exclusions first: a row never comes from the categories Bridge, Canonical Bridge, Liquid
// Staking, Liquid Restaking or Restaked. Wrapped, staked and bridged products of tokens that already
// trade are not tokens that do not exist yet.
//
// The implied value is what a protocol's token could plausibly launch at, read off the snapshot's own
// figures, no external data:
//
//   implied = max(1, round(tvl_usd x 0.25 x growthMult x stabilityMult x maturityMult x categoryMult x chainMult x watchlistMult))
//
//   growthMult     = 1 + clamp(change_7d, -60, 120)/100 x 0.3
//                    a week of flows leans the multiple a little: +120% tops it at 1.36, -60% floors it at 0.82
//   stabilityMult  = 1.0 when change_7d is null, else clamp(1 - |change_7d|/2, 0.7, 1.1)
//                    a violent week is discounted, but a modest dip can read as accumulation
//   maturityMult   = 0.6 + min(age_days, 1095)/1095 x 0.4
//                    age from listed_at against the snapshot's as_of; 365 days when listed_at is null
//   categoryMult   = the table below; categories the table omits score 1.0
//   chainMult      = 1.2 on 3 or more chains, 1.1 on 2, 1.0 on 1
//   watchlistMult  = 1.15 when the snapshot's watchlist names the slug, else 1.0
//
// The base multiple 0.25 reads TVL as a quarter of a launch valuation; the rest of the model tilts it.
// One exclusion beyond the house list, stated because it is a conviction the board wears openly: the
// CEX category holds incumbent exchanges — Bybit, Bitfinex, Robinhood and their peers — whose decade of
// business history, not their on-chain TVL, is the story. An exchange launching a token is a corporate
// event, not an airdrop a radar can farm, so the board discounts them hard (0.5) and the farm plan says
// plainly that their snapshots are internal. No protocol name is ever special-cased: the same function
// scores every row, and the same numbers always produce the same board.

import type { Snapshot, Protocol } from './snapshot.ts';

/** The model's constants, as the dashboard states them. */
export const MODEL = {
  base_multiple: 0.25,
  growth_weight: 0.3,
  growth_floor: -60,
  growth_cap: 120,
  stability_floor: 0.7,
  stability_cap: 1.1,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain2: 1.1,
  chain3: 1.2,
  watchlist: 1.15,
} as const;

/** Categories a row never comes from: wrapped, staked and bridged products of tokens that trade. */
export const EXCLUDED_CATEGORIES = ['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked'] as const;

/** The category table: categories the radar weights up, down or not at all. */
export const CATEGORY_MULTIPLIERS: Readonly<Record<string, number>> = {
  'Curator': 1.3,
  'Risk Curator': 1.3,
  'Risk Curators': 1.3,
  'DEX': 1.25,
  'Dexs': 1.25,
  'Lending': 1.25,
  'Uncollateralized Lending': 1.25,
  'Perps': 1.2,
  'Derivatives': 1.15,
  'Launchpad': 1.15,
  'Oracle': 1.1,
  'Yield': 1.1,
  'Infra': 1.05,
  'CEX': 0.5,
  'Bridge': 0.4,
  'Liquid Staking': 0.4,
};

/** A board row: one pre-token protocol, ranked, with the model's own numbers and a farm plan. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_multiplier: number;
    stability_multiplier: number;
    maturity_multiplier: number;
    category_multiplier: number;
    chain_multiplier: number;
    watchlist_multiplier: number;
  };
  farm_steps: string[];
}

/** The parsed snapshot, exactly the sealed file's shape. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** One protocol entry of the snapshot: the ten fields, and no others. */
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

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Is a protocol pre-token: the snapshot records no token for it at all. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Is a protocol excluded by category: a wrapped, staked or bridged product of something that trades. */
export function isExcluded(p: Protocol): boolean {
  return p.category !== null && (EXCLUDED_CATEGORIES as readonly string[]).includes(p.category);
}

/** Days between a listed_at date and the snapshot's as_of date; negative ages read as 0. */
export function ageDays(listed_at: string | null, as_of: string): number {
  if (listed_at === null) return MODEL.unknown_age_days;
  const start = Date.parse(`${listed_at}T00:00:00Z`);
  const end = Date.parse(`${as_of}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return MODEL.unknown_age_days;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Every multiplier but the base, as the dashboard's detail panel shows them. */
export interface Multipliers {
  growth_multiplier: number;
  stability_multiplier: number;
  maturity_multiplier: number;
  category_multiplier: number;
  chain_multiplier: number;
  watchlist_multiplier: number;
}

/** The six multipliers for one protocol; the score uses them at full precision. */
export function multipliers(p: Protocol, watchlisted: boolean, as_of: string): Multipliers {
  const growth = p.change_7d === null ? 0 : clamp(p.change_7d, MODEL.growth_floor, MODEL.growth_cap);
  const growth_multiplier = 1 + (growth / 100) * MODEL.growth_weight;
  const stability_multiplier = p.change_7d === null ? 1.0 : clamp(1 - Math.abs(p.change_7d) / 2, MODEL.stability_floor, MODEL.stability_cap);
  const age = ageDays(p.listed_at, as_of);
  const maturity_multiplier = MODEL.maturity_floor + (Math.min(age, MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
  const category_multiplier = p.category !== null && CATEGORY_MULTIPLIERS[p.category] !== undefined ? CATEGORY_MULTIIERS_SAFE(p.category) : 1.0;
  const chain_multiplier = p.chains.length >= 3 ? MODEL.chain3 : p.chains.length === 2 ? MODEL.chain2 : 1.0;
  const watchlist_multiplier = watchlisted ? MODEL.watchlist : 1.0;
  return { growth_multiplier, stability_multiplier, maturity_multiplier, category_multiplier, chain_multiplier, watchlist_multiplier };
}

/** Kept for the guards above: the table read is total, so this never throws; a missing category is 1.0. */
function CATEGORY_MULTIIERS_SAFE(category: string): number {
  return CATEGORY_MULTIPLIERS[category] ?? 1.0;
}

/** The implied value: the whole model in one line, as the header states it. */
export function impliedValue(p: Protocol, m: Multipliers, watchlisted: boolean): number {
  const raw = p.tvl_usd * MODEL.base_multiple * m.growth_multiplier * m.stability_multiplier * m.maturity_multiplier * m.category_multiplier * m.chain_multiplier * (watchlisted ? MODEL.watchlist : 1.0);
  return Math.max(1, Math.round(raw));
}

// ---------------------------------------------------------------- the farm plan

/** Farm-plan fragments by what a protocol is: a fresh wallet, a size, the weekly work, the exit hygiene. */
const PLAN: Readonly<Record<string, { thesis: string; size: (tvl: number) => string; weekly: string[]; exit: string }>> = {
  // Curators pick which collateral gets borrowed against: the user is the yield.
  'curator': {
    thesis: 'curator allocations are the airdrop\'s most likely unit of account: the protocol needs wallets that bring collateral and vote with it',
    size: (t) => `Open a fresh wallet, fund it with $2,000-5,000, and allocate it as curator collateral; the protocol's TVL is ${(t / 1e6).toFixed(0)}M, so a 4-figure wallet still registers`,
    weekly: ['Rebalance your curator allocation weekly toward the largest new vaults the protocol lists', 'Vote in every risk round the front end offers and keep each vote on-chain', 'Hold the position through two full weeks without withdrawing: continuity is the pattern airdrop filters look for'],
    exit: 'leave a residue deposited after any claim, and never bridge the whole balance out the week a token is expected',
  },
  'dex': {
    thesis: 'a DEX launches its token on its own liquidity, so early LPs and steady swappers are the cohort it remembers',
    size: (t) => `Use a fresh wallet with $1,500-4,000: half into the deepest pool's LP, the rest for 10+ split swaps across weeks (this DEX moves ${(t / 1e6).toFixed(0)}M in TVL)`,
    weekly: ['Provide LP on the deepest pool and compound fees back into the position weekly', 'Route a handful of real swaps through the front end every week, varying size and direction', 'Try each new pool or incentive vault the week it appears: new-feature users are tracked separately'],
    exit: 'claim and withdraw rewards to the same wallet, keep the LP at least half intact, and do not dump everything the day a farming program ends',
  },
  'lending': {
    thesis: 'lending markets need both sides, and the supplier cohort is the smaller one: being early on the supply side is the scarce act',
    size: (t) => `Fund a fresh wallet with $3,000-8,000 and deposit it as supply, then borrow a small fraction back; about ${(t / 1e6).toFixed(0)}M TVL means your deposit is visible but not outsized`,
    weekly: ['Keep the deposit in place weekly; top it up rather than cycling in and out', 'Borrow and repay the same asset in small amounts so the wallet shows the full borrow lifecycle', 'Turn on every new market the protocol opens and put a token deposit in each'],
    exit: 'repay all borrows before claiming anything, then withdraw no faster than you deposited: a clean close reads as a user, not a farmer',
  },
  'perps': {
    thesis: 'perps venues pay for volume before they pay for liquidity: a wallet with regular two-way flow is the pattern their points programs count',
    size: (t) => `Fund a fresh wallet with $2,000-6,000 of margin and trade it in clips of a few hundred dollars; the venue holds ${(t / 1e6).toFixed(0)}M in TVL so your flow is noise, which is fine`,
    weekly: ['Open and close both longs and shorts weekly; two-way volume counts double in most points schemes', 'Use limit orders on the book rather than market orders to show maker flow', 'Hit every new market the day it lists, even in small size'],
    exit: 'flatten to zero margin before any claim, spread withdrawals out, and keep the wallet funded between rounds rather than emptying it',
  },
  'derivatives': {
    thesis: 'options and structured desks reward wallets that hold the product, not just trade it: positions that reach expiry are the signal',
    size: (t) => `Fund a fresh wallet with $2,000-5,000 and hold structured or options positions to expiry in these ${(t / 1e6).toFixed(0)}M-TVL markets`,
    weekly: ['Roll or open at least one position weekly so the wallet never goes a week without one', 'Take both sides across weeks: a covered call one week, a put spread the next', 'Interact with each new vault type the week it launches'],
    exit: 'let positions settle on-chain rather than closing them off-book, claim proceeds to the same wallet, and keep a small position open through any expected snapshot',
  },
  'oracle': {
    thesis: 'oracles reward integrators and data submitters more than holders: the wallet that feeds or reads the feed is the one that counts',
    size: (t) => `Fund a fresh wallet with $500-2,000; an oracle needs participation, not capital, and its ${(t / 1e6).toFixed(0)}M TVL footprint is secured value, not deposits`,
    weekly: ['Use the front end\'s data-reading or staking functions weekly, however small', 'If the protocol runs a staking or delegation module, delegate and re-delegate weekly', 'Complete every testnet or feedback campaign the team announces; those lists become allowlists'],
    exit: 'keep the delegation live rather than unbonding fully, and claim rewards only through the official front end',
  },
  'launchpad': {
    thesis: 'launchpads reward wallets that join sales and stake the platform token (if any) before one exists: participation history is the allocation',
    size: (t) => `Fund a fresh wallet with $1,000-3,000 and commit it to every sale tier the pad runs while its projects carry ${(t / 1e6).toFixed(0)}M in TVL`,
    weekly: ['Enter every sale or allocation round weekly, even at the minimum ticket', 'Stake any intermediate receipt token the pad issues for commitments', 'Complete KYC or allowlist steps early; the wallets that finish them are the ones recorded'],
    exit: 'hold sale proceeds on the same wallet for weeks rather than sending them out; a launchpad snapshots loyalty, not size',
  },
  'yield': {
    thesis: 'yield protocols reward wallets whose deposits survive volatility: the depositor still there after a bad week is the one it counts',
    size: (t) => `Fund a fresh wallet with $2,000-6,000 and deposit across the two largest vaults; the protocol holds ${(t / 1e6).toFixed(0)}M, so mid-four-figures is a normal-size user`,
    weekly: ['Compound rewards back into the vaults weekly instead of claiming them out', 'Split deposits across at least two vault strategies so the wallet shows breadth', 'Deposit into each new vault within its first week'],
    exit: 'claim rewards no more often than monthly, keep half the deposit in place after any withdrawal, and avoid moving everything the week a points program ends',
  },
  'cex': {
    thesis: 'a CEX launch rewards accounts that trade and hold on the exchange itself: the airdrop, if any, is a retention play against on-chain users',
    size: (t) => `A CEX with ${(t / 1e6).toFixed(0)}M TVL launches to its own accounts first: keep a modest balance ($500-2,000) on the exchange, KYC\'d from one identity, and trade spot weekly`,
    weekly: ['Place a few small spot orders weekly across different pairs', 'Hold a stablecoin balance on-exchange rather than keeping the account empty', 'Use every new product the exchange ships: earn, staking, convert'],
    exit: 'withdraw nothing in the weeks before an expected token event; exchange-side snapshots are internal, so balances are read at intervals, not claimed',
  },
  'bridge': {
    thesis: 'bridges reward wallets that move real value in both directions over time: route diversity and two-way volume are the pattern',
    size: (t) => `Fund two fresh wallets (one per side) with $1,000-3,000 each; route volume through the bridge in both directions (${(t / 1e6).toFixed(0)}M TVL means your clips are small, which is fine)`,
    weekly: ['Bridge a few hundred dollars each way weekly, varying chains and assets', 'Use each new chain route the week it goes live; new-route users are the earliest cohort', 'Keep completed transfers, do not reverse them: completed legs are the unit most bridge programs count'],
    exit: 'let transfers settle fully between rounds, keep receipts on-chain, and avoid bridging the same pair back and forth in one day',
  },
  'default': {
    thesis: 'unranked categories farm the same way: a fresh wallet, steady weekly use, breadth across features, and hygiene at the exit',
    size: (t) => `Fund a fresh wallet with $1,500-5,000; against ${(t / 1e6).toFixed(0)}M of TVL that is a real user, not a whale and not dust`,
    weekly: ['Deposit or transact weekly in the protocol\'s main function, never skipping a week', 'Touch every new feature the team ships within its first week of launch', 'Keep all activity on one wallet so the history accumulates in a single address'],
    exit: 'claim rewards to the same wallet, keep a residue deposited after any withdrawal, and never move the full balance the week a token is rumored',
  },
};

/** The plan key for a category, matched by its leading word; curator, dex, lending and the rest fall out. */
function planKey(category: string | null): keyof typeof PLAN {
  if (category === null) return 'default';
  const c = category.toLowerCase();
  if (c.includes('curator')) return 'curator';
  if (c.includes('dex')) return 'dex';
  if (c.includes('lending') || c.startsWith('cdp')) return 'lending';
  if (c.startsWith('perp')) return 'perps';
  if (c.includes('derivative') || c.includes('option') || c.includes('interest rate')) return 'derivatives';
  if (c.startsWith('oracle')) return 'oracle';
  if (c.startsWith('launchpad')) return 'launchpad';
  if (c.startsWith('yield')) return 'yield';
  if (c.startsWith('cex') || c.startsWith('cedefi')) return 'cex';
  if (c.includes('bridge')) return 'bridge';
  return 'default';
}

/** The farm plan: 4-5 concrete steps, tailored by category, each naming a size, a cadence and an exit. */
export function farmSteps(p: Protocol): string[] {
  const plan = PLAN[planKey(p.category)];
  const first = `Create a fresh wallet that has never touched this protocol, and keep every step below on it alone: ${plan.thesis}.`;
  const steps = [first, plan.size(p.tvl_usd), ...plan.weekly, `Exit hygiene: ${plan.exit}.`];
  if (p.chains.length >= 3) {
    steps.splice(2, 0, `The protocol runs on ${p.chains.length} chains (${p.chains.slice(0, 3).join(', ')} and more): split the wallet's activity across at least two of them, since multi-chain users are the scarcer cohort`);
  }
  return steps;
}

// ---------------------------------------------------------------- the board

/** Every pre-token protocol outside the excluded categories, scored, ranked and planned. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const watchlisted = new Set(snapshot.watchlist);
  const eligible = snapshot.protocols.filter((p) => isPreToken(p) && !isExcluded(p));
  const scored = eligible.map((p) => {
    const wl = watchlisted.has(p.slug);
    const m = multipliers(p, wl, snapshot.as_of);
    return { p, m, wl, implied: impliedValue(p, m, wl) };
  });
  scored.sort((a, b) => b.implied - a.implied || a.p.slug.localeCompare(b.p.slug));
  return scored.map(({ p, m, wl, implied }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: ageDays(p.listed_at, snapshot.as_of),
    watchlist: wl,
    implied_value_usd: implied,
    model: {
      base_multiple: MODEL.base_multiple,
      growth_multiplier: m.growth_multiplier,
      stability_multiplier: m.stability_multiplier,
      maturity_multiplier: m.maturity_multiplier,
      category_multiplier: m.category_multiplier,
      chain_multiplier: m.chain_multiplier,
      watchlist_multiplier: m.watchlist_multiplier,
    },
    farm_steps: farmSteps(p),
  }));
}

/** What the gate checks first: slugs once each, ranks 1..n in order, positive implied values, 3-12 steps of 20-600 chars. */
export function boardIssue(board: BoardRow[]): string | null {
  const seen = new Set<string>();
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i} (${r.slug}) carries rank ${r.rank}, expected ${i + 1}`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (!(r.implied_value_usd >= 1)) return `row ${r.slug} has an implied value under $1`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `row ${r.slug} carries ${r.farm_steps?.length} farm steps, outside 3-12`;
    for (const step of r.farm_steps) {
      const t = step.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} trimmed characters, outside 20-600`;
    }
  }
  return null;
}
