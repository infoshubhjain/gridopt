import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario, ScenarioInputError, validateScenario } from './model.js';
import { verifyDispatch } from './optimizer.js';
import { solveDispatch } from './solver.js';

export const app = express();
const port = Number(process.env.PORT || 3000);
const here = path.dirname(fileURLToPath(import.meta.url));
const buckets = new Map<string, { start: number; count: number }>();
let active = 0, lastCleanup = 0;
const runCache = new Map<string, { until: number; result: ReturnType<typeof runScenario> }>();
app.disable('x-powered-by');
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 5) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
app.set('trust proxy', proxyHops);
app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
  next();
});
app.use((req, res, next) => {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  if (now - lastCleanup > 60_000) {
    for (const [address, entry] of buckets) if (now - entry.start > 60_000) buckets.delete(address);
    lastCleanup = now;
  }
  const bucket = buckets.get(ip);
  if (!bucket && buckets.size >= 5000) { res.status(429).json({ error: 'Too many different clients. Try again later.' }); return; }
  if (!bucket || now - bucket.start > 60_000) buckets.set(ip, { start: now, count: 1 });
  else if (++bucket.count > 90) { res.status(429).json({ error: 'Too many requests. Try again in a minute.' }); return; }
  next();
});
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/scenarios/demo', (_req, res) => res.json(demoScenario()));
app.post('/api/run', async (req, res) => {
  if (active >= 2) { res.status(503).json({ error: 'The optimizer is busy. Try again shortly.' }); return; }
  active++;
  try {
    const scenario = validateScenario(req.body);
    const cacheKey = JSON.stringify(scenario);
    const cached = runCache.get(cacheKey);
    if (cached && cached.until > Date.now()) {
      res.set('X-GridOpt-Cache', 'HIT').json(cached.result);
      return;
    }
    const result = runScenario(scenario);
    const solved = await solveDispatch(scenario);
    if (solved.status === 'Optimal') {
      const rows = solved.intervals;
      if (!verifyDispatch(scenario, rows)) throw new Error('Optimizer solution failed independent energy, SOC, or terminal checks.');
      const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
      result.strategies.optimized = {
        intervals: rows, totalCost, inventoryAdjustment: 0, adjustedCost: totalCost,
        importedKWh: rows.reduce((sum, row) => sum + row.importKW * scenario.intervalHours, 0),
        exportedKWh: rows.reduce((sum, row) => sum + row.exportKW * scenario.intervalHours, 0),
        curtailedKWh: rows.reduce((sum, row) => sum + row.curtailmentKW * scenario.intervalHours, 0),
        unmetKWh: 0, finalSocKWh: rows.at(-1)!.socKWh,
      };
      result.optimization = { status: solved.status, runtimeMs: solved.runtimeMs, verified: true };
    } else result.optimization = { status: solved.status, runtimeMs: solved.runtimeMs, verified: false };
    result.objective = 'HiGHS mixed-integer linear optimization minimizes imported energy cost net of export revenue, with explicit power balance, charge/discharge exclusivity, battery efficiency, SOC reserve/capacity, and terminal SOC equal to initial SOC. The rule-based strategy remains a heuristic benchmark.';
    if (result.optimization?.verified) {
      runCache.set(cacheKey, { until: Date.now() + 300_000, result });
      if (runCache.size > 16) runCache.delete(runCache.keys().next().value!);
    }
    res.set('X-GridOpt-Cache', 'MISS').json(result);
  }
  catch (e) { res.status(e instanceof ScenarioInputError || e instanceof Error && e.name === 'ZodError' ? 400 : 503).json({ error: e instanceof Error ? e.message : 'Could not run scenario.' }); }
  finally { active--; }
});
app.post('/api/sensitivity', async (req, res) => {
  if (active >= 2) { res.status(503).json({ error: 'The optimizer is busy. Try again shortly.' }); return; }
  active++;
  try {
    const scenario = validateScenario(req.body?.scenario);
    const factors = [.5, 1, 1.5];
    const candidates = factors.map((factor) => {
      try { return validateScenario({ ...scenario, batteryKWh: scenario.batteryKWh * factor, batteryKW: scenario.batteryKW * factor }); }
      catch (e) { if (e instanceof Error && e.name === 'ZodError') return null; throw e; }
    });
    const heuristicCosts = candidates.map(candidate => candidate ? runScenario(candidate).strategies.ruleBased.adjustedCost : null);
    const optimizedCosts: (number | null)[] = [];
    const optimizationStatuses: string[] = [];
    for (const candidate of candidates) {
      if (!candidate) { optimizedCosts.push(null); optimizationStatuses.push('Outside supported capacity range'); continue; }
      const cached = runCache.get(JSON.stringify(candidate));
      if (cached && cached.until > Date.now() && cached.result.strategies.optimized) {
        optimizedCosts.push(cached.result.strategies.optimized.totalCost);
        optimizationStatuses.push('Optimal · independently verified · cached');
        continue;
      }
      const solved = await solveDispatch(candidate);
      const verified = solved.status === 'Optimal' && verifyDispatch(candidate, solved.intervals);
      optimizedCosts.push(verified ? solved.intervals.reduce((sum, row) => sum + row.cost, 0) : null);
      optimizationStatuses.push(verified ? 'Optimal · independently verified' : solved.status);
    }
    res.json({ factors, heuristicCosts, optimizedCosts, optimizationStatuses });
  } catch (e) { res.status(e instanceof ScenarioInputError || e instanceof Error && e.name === 'ZodError' ? 400 : 503).json({ error: e instanceof Error ? e.message : 'Sensitivity unavailable.' }); }
  finally { active--; }
});
app.post('/api/data/eia', async (req, res) => {
  const { key = process.env.EIA_API_KEY, respondent, hours } = req.body ?? {};
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) { res.status(400).json({ error: 'Provide a valid EIA API key. Register free at eia.gov/opendata.' }); return; }
  if (!['MISO', 'PJM', 'NYIS', 'CAISO'].includes(respondent) || !Number.isInteger(hours) || hours < 24 || hours > 168) { res.status(400).json({ error: 'Choose MISO, PJM, NYIS, or CAISO and a horizon from 24 to 168 hours.' }); return; }
  if (active >= 4) { res.status(503).json({ error: 'The optimizer is busy. Try again shortly.' }); return; }
  active++;
  const end = new Date(); end.setUTCMinutes(0, 0, 0); end.setUTCHours(end.getUTCHours() - 2);
  const start = new Date(end.getTime() - (hours - 1) * 3_600_000);
  const url = new URL('https://api.eia.gov/v2/electricity/rto/region-data/data/');
  for (const [k, v] of Object.entries({ api_key: key, 'data[0]': 'value', frequency: 'hourly', 'facets[respondent][]': respondent, 'facets[type][]': 'D', start: start.toISOString().slice(0, 13).replace('Z', ''), end: end.toISOString().slice(0, 13).replace('Z', ''), 'sort[0][column]': 'period', 'sort[0][direction]': 'asc', length: String(hours) })) url.searchParams.set(k, v);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`EIA returned HTTP ${response.status}.`);
    const body = await response.json() as { response?: { data?: { period?: string; value?: number | string }[] }; error?: string };
    if (!body.response?.data?.length) throw new Error(body.error || 'EIA returned no hourly demand observations for this period.');
    const values = body.response.data.map(x => Number(x.value));
    const timestamps = body.response.data.map(x => new Date(Date.parse(x.period!.length === 13 ? `${x.period}:00Z` : x.period!) - 3_600_000).toISOString());
    if (values.length !== hours || values.some(x => !Number.isFinite(x) || x < 0) || timestamps.some((t, i) => i > 0 && Date.parse(t) - Date.parse(timestamps[i - 1]) !== 3_600_000)) throw new Error('EIA returned missing, invalid, or uneven hourly demand data.');
    res.json({ values, timestamps, source: 'EIA Form EIA-930, hourly balancing-authority demand (MWh); UTC hour-ending observations shifted to interval start.', respondent, unit: 'MWh per hourly interval', provenance: 'Historical regional demand normalized to the example microgrid peak for shape context only. Not a site load forecast.' });
  } catch (e) { res.status(502).json({ error: e instanceof Error ? e.message : 'EIA request failed.' }); }
  finally { active--; }
});

const client = path.resolve(here, '../dist');
app.use(express.static(client));
app.get(/.*/, (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(client, 'index.html')));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  void _next;
  const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : 400;
  res.status(status).json({ error: status === 413 ? 'Request body exceeds the 256 KB limit.' : 'Invalid request body.' });
});
if (process.env.NODE_ENV !== 'test') app.listen(port, '0.0.0.0', () => process.stdout.write(`GridOpt listening on ${port}\n`));

function demoScenario() {
  const intervals = Array.from({ length: 24 }, (_, h) => {
    const solarKW = Math.max(0, 5.5 * Math.sin(Math.PI * (h - 6) / 12));
    const eveningPeak = h >= 17 && h <= 21 ? 2.8 : 0;
    return { timestamp: new Date(Date.UTC(2025, 5, 21, h)).toISOString(), loadKW: +(2.2 + 0.75 * Math.sin((h - 7) * Math.PI / 12) + eveningPeak).toFixed(3), solarKW: +solarKW.toFixed(3), windKW: +(0.5 + 0.25 * Math.cos(h * Math.PI / 6)).toFixed(3), pricePerKWh: h >= 16 && h <= 21 ? 0.32 : h >= 0 && h <= 5 ? 0.09 : 0.16 };
  });
  return { name: 'Illustrative summer microgrid · synthetic', intervalHours: 1, batteryKWh: 8, batteryKW: 4, roundTripEfficiency: 0.9, minSocFraction: 0.15, initialSocFraction: 0.55, exportAllowed: true, exportPrice: 0.05, intervals };
}
