import test from 'node:test';
import assert from 'node:assert/strict';
import { runScenario, validateScenario, type Scenario } from './model.js';

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    name: 'test', intervalHours: 1, batteryKWh: 4, batteryKW: 2, roundTripEfficiency: .81,
    minSocFraction: .1, initialSocFraction: .5, exportAllowed: false, exportPrice: 0,
    intervals: [
      { timestamp: '2026-03-08T01:00:00-05:00', loadKW: 1, solarKW: 0, windKW: 0, pricePerKWh: .1 },
      { timestamp: '2026-03-08T03:00:00-04:00', loadKW: 2, solarKW: 0, windKW: 0, pricePerKWh: .4 },
    ], ...overrides,
  };
}

test('dispatch is deterministic and independently feasible across DST offset change', () => {
  const s = validateScenario(scenario());
  const a = runScenario(s), b = runScenario(s);
  assert.deepEqual(a, b);
  assert.equal(a.verified, true);
  assert.ok(a.strategies.ruleBased.intervals[1].socKWh >= .4);
  for (const row of a.strategies.ruleBased.intervals) {
    assert.ok(row.socKWh >= .4 && row.socKWh <= 4);
    assert.ok(!(row.chargeKW && row.dischargeKW));
  }
});

test('calculates interval energy cost from kW, hours, and tariff', () => {
  const s = scenario({ batteryKWh: 0, batteryKW: 0, intervals: [{ timestamp: '2025-01-01T00:00:00Z', loadKW: 2, solarKW: 0, windKW: 0, pricePerKWh: .25 }] });
  const result = runScenario(validateScenario(s));
  assert.equal(result.strategies.baseline.totalCost, .5);
  assert.equal(result.strategies.baseline.importedKWh, 2);
});

test('normalizes cost when dispatch depletes starting battery inventory', () => {
  const s = validateScenario(scenario({
    minSocFraction: 0,
    intervals: [{ timestamp: '2025-01-01T00:00:00Z', loadKW: 1, solarKW: 0, windKW: 0, pricePerKWh: .4 }],
  }));
  const result = runScenario(s).strategies;
  assert.equal(result.baseline.adjustedCost, result.baseline.totalCost);
  assert.ok(result.ruleBased.finalSocKWh < s.batteryKWh * s.initialSocFraction);
  assert.ok(result.ruleBased.adjustedCost > result.baseline.adjustedCost);
});

test('accounts for export income or curtailment according to the export setting', () => {
  const intervals = [{ timestamp: '2025-01-01T00:00:00Z', loadKW: 1, solarKW: 5, windKW: 0, pricePerKWh: .25 }];
  const exportResult = runScenario(validateScenario(scenario({ batteryKWh: 0, batteryKW: 0, exportAllowed: true, exportPrice: .1, intervals })));
  assert.equal(exportResult.strategies.baseline.exportedKWh, 4);
  assert.equal(exportResult.strategies.baseline.totalCost, -.4);
  const curtailedResult = runScenario(validateScenario(scenario({ batteryKWh: 0, batteryKW: 0, exportAllowed: false, intervals })));
  assert.equal(curtailedResult.strategies.baseline.curtailedKWh, 4);
  assert.equal(curtailedResult.strategies.baseline.totalCost, 0);
});

test('models round-trip losses and exact quarter-hour energy units', () => {
  const s = scenario({ intervalHours: .25, batteryKWh: 10, batteryKW: 4, initialSocFraction: .5, minSocFraction: 0,
    intervals: [
      { timestamp: '2025-01-01T00:00:00Z', loadKW: 0, solarKW: 4, windKW: 0, pricePerKWh: .1 },
      { timestamp: '2025-01-01T00:15:00Z', loadKW: 2, solarKW: 0, windKW: 0, pricePerKWh: .5 },
    ] });
  const out = runScenario(validateScenario(s)).strategies.ruleBased.intervals;
  assert.equal(out[0].chargeKW, 4);
  assert.equal(out[1].dischargeKW, 2);
  assert.ok(Math.abs(out[0].socKWh - (5 + 4 * .9 * .25)) < 1e-9);
  assert.ok(Math.abs(out[1].socKWh - (out[0].socKWh - 2 / .9 * .25)) < 1e-9);
});

test('zero generation and zero-capacity systems stay feasible and import unmet load', () => {
  const s = scenario({ batteryKWh: 0, batteryKW: 0, minSocFraction: 0, initialSocFraction: 0, intervals: [{ timestamp: '2025-01-01T00:00:00Z', loadKW: 3, solarKW: 0, windKW: 0, pricePerKWh: .12 }] });
  const out = runScenario(validateScenario(s)).strategies.ruleBased;
  assert.equal(out.importedKWh, 3);
  assert.equal(out.unmetKWh, 0);
  assert.equal(out.finalSocKWh, 0);
});

test('rejects missing rows, uneven intervals, and initial SOC below reserve', () => {
  assert.throws(() => validateScenario({ ...scenario(), intervals: [] }));
  assert.throws(() => validateScenario(scenario({ intervals: [
    { timestamp: '2025-01-01T00:00:00Z', loadKW: 0, solarKW: 0, windKW: 0, pricePerKWh: 0 },
    { timestamp: '2025-01-01T02:00:00Z', loadKW: 0, solarKW: 0, windKW: 0, pricePerKWh: 0 },
  ] })));
  assert.throws(() => validateScenario(scenario({ minSocFraction: .6, initialSocFraction: .5 })));
});
