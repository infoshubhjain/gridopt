import { z } from 'zod';

export const scenarioSchema = z.object({
  name: z.string().min(1).max(80).default('Example microgrid'),
  intervalHours: z.number().min(0.25).max(24),
  batteryKWh: z.number().min(0).max(5000),
  batteryKW: z.number().min(0).max(2000),
  roundTripEfficiency: z.number().gt(0).max(1),
  minSocFraction: z.number().min(0).max(1),
  initialSocFraction: z.number().min(0).max(1),
  exportAllowed: z.boolean(),
  exportPrice: z.number().min(0).max(10),
  intervals: z.array(z.object({
    timestamp: z.string().datetime({ offset: true }),
    loadKW: z.number().min(0).max(10000),
    solarKW: z.number().min(0).max(10000),
    windKW: z.number().min(0).max(10000),
    pricePerKWh: z.number().min(0).max(10),
  })).min(1).max(168),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type Strategy = 'baseline' | 'ruleBased';
export type IntervalResult = {
  timestamp: string; loadKW: number; solarKW: number; windKW: number; chargeKW: number;
  dischargeKW: number; socKWh: number; importKW: number; exportKW: number; curtailmentKW: number;
  unmetKW: number; cost: number;
};

export function validateScenario(raw: unknown): Scenario {
  const scenario = scenarioSchema.parse(raw);
  const times = scenario.intervals.map(({ timestamp }) => Date.parse(timestamp));
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] !== scenario.intervalHours * 3_600_000) throw new Error('Timestamps must be strictly ordered and evenly spaced at the selected interval.');
  }
  if (scenario.initialSocFraction < scenario.minSocFraction) throw new Error('Initial state of charge must be at or above the reserve target.');
  return scenario;
}

function dispatch(s: Scenario, strategy: Strategy): IntervalResult[] {
  const capacity = s.batteryKWh;
  const eta = Math.sqrt(s.roundTripEfficiency);
  let soc = capacity * s.initialSocFraction;
  const prices = s.intervals.map(x => x.pricePerKWh).sort((a, b) => a - b);
  const cheap = prices[Math.floor((prices.length - 1) * 0.35)];
  const dear = prices[Math.floor((prices.length - 1) * 0.75)];
  return s.intervals.map((p) => {
    const renewable = p.solarKW + p.windKW;
    const surplus = Math.max(0, renewable - p.loadKW);
    const deficit = Math.max(0, p.loadKW - renewable);
    let chargeKW = 0, dischargeKW = 0;
    if (strategy === 'ruleBased' && capacity > 0 && s.batteryKW > 0) {
      const room = Math.max(0, (capacity - soc) / (eta * s.intervalHours));
      chargeKW = Math.min(s.batteryKW, room, surplus);
      if (surplus === 0 && p.pricePerKWh <= cheap) chargeKW = Math.min(s.batteryKW, room);
      if (surplus === 0 && p.pricePerKWh >= dear && deficit > 0) {
        chargeKW = 0;
        dischargeKW = Math.min(s.batteryKW, deficit, Math.max(0, (soc - capacity * s.minSocFraction) * eta / s.intervalHours));
      }
    }
    const raw = renewable + dischargeKW - p.loadKW - chargeKW;
    const importKW = Math.max(0, -raw);
    const excessKW = Math.max(0, raw);
    const exportKW = s.exportAllowed ? excessKW : 0;
    const curtailmentKW = s.exportAllowed ? 0 : excessKW;
    const unmetKW = 0;
    soc += (chargeKW * eta - dischargeKW / eta) * s.intervalHours;
    const cost = importKW * s.intervalHours * p.pricePerKWh - exportKW * s.intervalHours * s.exportPrice;
    return { timestamp: p.timestamp, loadKW: p.loadKW, solarKW: p.solarKW, windKW: p.windKW, chargeKW, dischargeKW, socKWh: soc, importKW, exportKW, curtailmentKW, unmetKW, cost };
  });
}

export function runScenario(s: Scenario) {
  const baseline = dispatch(s, 'baseline');
  const ruleBased = dispatch(s, 'ruleBased');
  const check = (rows: IntervalResult[]) => rows.every((r, i) => {
    const p = s.intervals[i];
    const before = i === 0 ? s.batteryKWh * s.initialSocFraction : rows[i - 1].socKWh;
    const recurrence = before + (r.chargeKW * Math.sqrt(s.roundTripEfficiency) - r.dischargeKW / Math.sqrt(s.roundTripEfficiency)) * s.intervalHours;
    const balance = r.importKW - r.exportKW - r.curtailmentKW + p.solarKW + p.windKW + r.dischargeKW - r.chargeKW - p.loadKW;
    return Math.abs(recurrence - r.socKWh) < 1e-7 && Math.abs(balance) < 1e-7 && r.socKWh >= s.batteryKWh * s.minSocFraction - 1e-7 && r.socKWh <= s.batteryKWh + 1e-7 && r.chargeKW * r.dischargeKW === 0 && r.chargeKW <= s.batteryKW && r.dischargeKW <= s.batteryKW;
  });
  if (!check(baseline) || !check(ruleBased)) throw new Error('Dispatch failed the independent physics check.');
  const summarize = (rows: IntervalResult[]) => ({
    totalCost: rows.reduce((n, r) => n + r.cost, 0),
    importedKWh: rows.reduce((n, r) => n + r.importKW * s.intervalHours, 0),
    exportedKWh: rows.reduce((n, r) => n + r.exportKW * s.intervalHours, 0),
    curtailedKWh: rows.reduce((n, r) => n + r.curtailmentKW * s.intervalHours, 0),
    unmetKWh: rows.reduce((n, r) => n + r.unmetKW * s.intervalHours, 0),
    finalSocKWh: rows.at(-1)!.socKWh,
  });
  return { scenario: s, objective: 'Compare illustrative energy charges subject to interval power balance, battery power limits and SOC bounds. Rule-based dispatch charges renewable surplus or at low-price hours and discharges at high-price hours; it is a heuristic, not a mathematical optimizer. Final SOC is unconstrained and shown in the results.', strategies: { baseline: { intervals: baseline, ...summarize(baseline) }, ruleBased: { intervals: ruleBased, ...summarize(ruleBased) } }, verified: true, tolerance: '1e-7 kW/kWh' };
}
