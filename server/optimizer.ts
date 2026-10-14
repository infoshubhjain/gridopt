import loadHighs from 'highs';
import type { IntervalResult, Scenario } from './model.js';

export function verifyDispatch(s: Scenario, rows: IntervalResult[]) {
  const initialSocKWh = s.batteryKWh * s.initialSocFraction;
  return rows.length === s.intervals.length && rows.every((row, i) => {
    const p = s.intervals[i]!;
    const before = i ? rows[i - 1]!.socKWh : initialSocKWh;
    const eta = Math.sqrt(s.roundTripEfficiency);
    const soc = before + (row.chargeKW * eta - row.dischargeKW / eta) * s.intervalHours;
    const balance = row.importKW - row.exportKW - row.curtailmentKW + p.solarKW + p.windKW + row.dischargeKW - row.chargeKW - p.loadKW;
    const values = [row.chargeKW, row.dischargeKW, row.importKW, row.exportKW, row.curtailmentKW, row.socKWh];
    return values.every(Number.isFinite) && row.chargeKW >= -1e-6 && row.chargeKW <= s.batteryKW + 1e-6 && row.dischargeKW >= -1e-6 && row.dischargeKW <= s.batteryKW + 1e-6 && row.importKW >= -1e-6 && row.exportKW >= -1e-6 && row.curtailmentKW >= -1e-6 && (!s.exportAllowed ? row.exportKW < 1e-6 : row.exportKW <= Math.max(0, p.solarKW + p.windKW + s.batteryKW - p.loadKW) + 1e-6) && Math.abs(soc - row.socKWh) < 1e-6 && Math.abs(balance) < 1e-6 && row.socKWh >= s.batteryKWh * s.minSocFraction - 1e-6 && row.socKWh <= s.batteryKWh + 1e-6 && row.chargeKW * row.dischargeKW < 1e-8 && row.importKW * row.exportKW < 1e-8;
  }) && Math.abs(rows.at(-1)!.socKWh - initialSocKWh) < 1e-6;
}

type HighsRuntime = {
  solve(problem: string, options: { output_flag: boolean; time_limit: number; mip_rel_gap: number }): {
    Status: string;
    Columns: Record<string, { Primal: number }>;
  };
};
const loadRuntime = loadHighs as unknown as () => Promise<HighsRuntime>;
let highsPromise: Promise<HighsRuntime> | undefined;
const highs = () => (highsPromise ??= loadRuntime());

export async function optimizeDispatch(s: Scenario) {
  const started = performance.now();
  const solver = await highs();
  const eta = Math.sqrt(s.roundTripEfficiency), dt = s.intervalHours;
  const initial = s.batteryKWh * s.initialSocFraction;
  const minSoc = s.batteryKWh * s.minSocFraction;
  const rows: string[] = [], costs: [string, number][] = [], bounds: string[] = [], binaries: string[] = [];
  const terms = (pairs: [string, number][]) => pairs.filter(([, c]) => Math.abs(c) > 1e-12).map(([v, c]) => `${c < 0 ? '-' : '+'} ${Math.abs(c)} ${v}`).join(' ');
  for (let i = 0; i < s.intervals.length; i++) {
    const p = s.intervals[i]!, gen = p.solarKW + p.windKW;
    const impMax = Math.max(1, p.loadKW + s.batteryKW);
    const expMax = Math.max(0, gen + s.batteryKW);
    const charge = `charge_${i}`, discharge = `discharge_${i}`, imp = `import_${i}`, exp = `export_${i}`;
    const curtail = `curtail_${i}`, chargeMode = `charge_mode_${i}`, gridMode = `grid_mode_${i}`;
    costs.push([imp, p.pricePerKWh * dt], [exp, -s.exportPrice * dt]);
    rows.push(`balance_${i}: ${terms([[imp, 1], [exp, -1], [discharge, 1], [charge, -1], [curtail, -1]])} = ${p.loadKW - gen}`);
    rows.push(`charge_limit_${i}: ${terms([[charge, 1], [chargeMode, -s.batteryKW]])} <= 0`);
    rows.push(`discharge_limit_${i}: ${terms([[discharge, 1], [chargeMode, s.batteryKW]])} <= ${s.batteryKW}`);
    rows.push(`import_mode_${i}: ${terms([[imp, 1], [gridMode, -impMax]])} <= 0`);
    rows.push(`export_mode_${i}: ${terms([[exp, 1], [gridMode, expMax]])} <= ${expMax}`);
    rows.push(`soc_step_${i}: ${terms([[`soc_${i + 1}`, 1], [`soc_${i}`, -1], [charge, -eta * dt], [discharge, dt / eta]])} = 0`);
    bounds.push(`${charge} <= ${s.batteryKW}`, `${discharge} <= ${s.batteryKW}`, `${imp} <= ${impMax}`, `${exp} <= ${s.exportAllowed ? expMax : 0}`, `${curtail} <= ${Math.max(1, gen + s.batteryKW)}`, `${chargeMode} <= 1`, `${gridMode} <= 1`);
    binaries.push(chargeMode, gridMode);
  }
  for (let i = 0; i <= s.intervals.length; i++) {
    bounds.push(`soc_${i} >= ${minSoc}`, `soc_${i} <= ${s.batteryKWh}`);
  }
  rows.push(`initial_soc: soc_0 = ${initial}`, `terminal_soc: soc_${s.intervals.length} = ${initial}`);
  const problem = `Minimize\n total_cost: ${terms(costs) || '0 charge_0'}\nSubject To\n ${rows.join('\n ')}\nBounds\n ${bounds.join('\n ')}\nBinary\n ${binaries.join(' ')}\nEnd`;
  const solved = solver.solve(problem, { output_flag: false, time_limit: 8, mip_rel_gap: 0 });
  if (solved.Status !== 'Optimal') {
    return { status: solved.Status, intervals: [] as IntervalResult[], runtimeMs: Math.round(performance.now() - started) };
  }
  const value = (name: string) => solved.Columns[name]?.Primal ?? 0;
  const intervals = s.intervals.map((p, i) => {
    const chargeKW = value(`charge_${i}`), dischargeKW = value(`discharge_${i}`);
    const importKW = value(`import_${i}`), exportKW = value(`export_${i}`), curtailmentKW = value(`curtail_${i}`);
    return { timestamp: p.timestamp, loadKW: p.loadKW, solarKW: p.solarKW, windKW: p.windKW, chargeKW, dischargeKW, socKWh: value(`soc_${i + 1}`), importKW, exportKW, curtailmentKW, unmetKW: 0, cost: (importKW * p.pricePerKWh - exportKW * s.exportPrice) * dt };
  });
  return { status: solved.Status, intervals, runtimeMs: Math.round(performance.now() - started) };
}
