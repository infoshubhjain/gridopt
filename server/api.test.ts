import test, { after, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';

let server: Server, base: string;
const localFetch = globalThis.fetch.bind(globalThis);
before(async () => {
  process.env.NODE_ENV = 'test';
  const { app } = await import('./index.js');
  assert.equal(app.get('trust proxy'), 0);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start test API');
  base = `http://127.0.0.1:${address.port}`;
});
after(() => server.close());

test('health, seeded demo, and scenario API work without credentials', async () => {
  assert.equal((await (await fetch(`${base}/api/health`)).json()).ok, true);
  const demo = await (await fetch(`${base}/api/scenarios/demo`)).json() as Record<string, unknown>;
  assert.match(String(demo.name), /synthetic/i);
  const response = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demo) });
  assert.equal(response.status, 200);
  const result = await response.json() as { verified:boolean; strategies:Record<string,unknown>; optimization:{status:string;verified:boolean} };
  assert.equal(result.verified, true);
  assert.equal(result.optimization.status, 'Optimal');
  assert.equal(result.optimization.verified, true);
  assert.ok(result.strategies.optimized);
  const sensitivity = await fetch(`${base}/api/sensitivity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scenario: demo }) });
  assert.equal(sensitivity.status, 200);
  assert.equal((await sensitivity.json() as { costs:number[] }).costs.length, 3);
});

test('invalid scenarios and missing EIA credentials fail explicitly', async () => {
  assert.equal((await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  const eia = await fetch(`${base}/api/data/eia`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ respondent: 'MISO', hours: 24 }) });
  assert.equal(eia.status, 400);
  assert.match((await eia.json() as { error:string }).error, /API key/);
});

test('EIA demand is fetched from the data route and returned in UTC with source units', async () => {
  const start = Date.UTC(2026, 9, 1);
  const data = Array.from({ length: 24 }, (_, i) => ({ period: new Date(start + i * 3_600_000).toISOString().slice(0, 13), value: String(100 + i) }));
  const fetchStub = mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    assert.match(String(input), /region-data\/data\//);
    return new Response(JSON.stringify({ response: { data } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  try {
    const response = await localFetch(`${base}/api/data/eia`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'DEMO_KEY', respondent: 'MISO', hours: 24 }) });
    assert.equal(response.status, 200);
    const body = await response.json() as { values:number[]; timestamps:string[]; unit:string };
    assert.equal(body.values[0], 100);
    assert.equal(body.timestamps[0], '2026-10-01T00:00:00.000Z');
    assert.match(body.unit, /MWh/);
  } finally { fetchStub.mock.restore(); }
});
