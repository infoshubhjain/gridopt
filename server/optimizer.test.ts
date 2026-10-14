import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeDispatch } from './optimizer.js';
import { validateScenario, type Scenario } from './model.js';

const makeScenario = (overrides: Partial<Scenario> = {}): Scenario => ({
  name: 'optimizer fixture', intervalHours: 1, batteryKWh: 1, batteryKW: 1,
  roundTripEfficiency: 1, minSocFraction: 0, initialSocFraction: .5,
  exportAllowed: false, exportPrice: 0,
  intervals: [
    { timestamp: '2025-01-01T00:00:00Z', loadKW: 0, solarKW: 1, windKW: 0, pricePerKWh: .1 },
    { timestamp: '2025-01-01T01:00:00Z', loadKW: 1, solarKW: 0, windKW: 0, pricePerKWh: .5 },
  ], ...overrides,
});

test('MILP proves a feasible minimum-cost schedule with terminal SOC restored', async () => {
  const scenario = validateScenario(makeScenario());
  const result = await optimizeDispatch(scenario);
  assert.equal(result.status, 'Optimal');
  assert.equal(result.intervals.length, 2);
  assert.ok(result.intervals[0]!.chargeKW > .49);
  assert.ok(result.intervals[1]!.dischargeKW > .49);
  assert.ok(Math.abs(result.intervals[1]!.socKWh - .5) < 1e-6);
  assert.ok(result.intervals.every((row) => !(row.chargeKW > 1e-6 && row.dischargeKW > 1e-6)));
});

test('zero-capacity and zero-load case solves without fabricated dispatch', async () => {
  const s = validateScenario(makeScenario({ batteryKWh: 0, batteryKW: 0, initialSocFraction: 0, intervals: [{ timestamp: '2025-01-01T00:00:00Z', loadKW: 0, solarKW: 0, windKW: 0, pricePerKWh: 0 }] }));
  const result = await optimizeDispatch(s);
  assert.equal(result.status, 'Optimal');
  assert.equal(result.intervals[0]!.chargeKW, 0);
  assert.equal(result.intervals[0]!.dischargeKW, 0);
});
