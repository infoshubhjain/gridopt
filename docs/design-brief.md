# GridOpt: product design brief

## Audit and direction

1. **Difference:** A small, auditable battery-dispatch benchmark compares a verified HiGHS MILP schedule with a transparent heuristic.
2. **User:** A student or energy analyst testing how load, renewables, capacity, and tariff inputs change modeled dispatch.
3. **Concept:** An instrument-style engineering workbench on chalk paper, with signal-lime and energy-flow colors. The interval trace replaces a generic KPI-first dashboard.
4. **Primary action:** Configure a scenario, run comparison, switch schedules, inspect an interval, and export the complete result.
5. **Technical proof:** The workbench exposes charge/discharge, grid balance, SOC, solver status, independent feasibility, and a capacity sensitivity experiment.
6. **Visualization:** Aligned power time series and SOC trajectory, both keyed to the active strategy and inspected interval; an accounting table separates raw cost from battery inventory adjustment.
7. **Remove:** The unused sidebar selectors were removed in the previous release. Do not add decorative telemetry or claim observed savings from synthetic tariffs.
8. **Complete it:** Make selected interval visible in both charts and allow direct selection from the energy profile. The slider remains keyboard-accessible.

## Implementation map

`src/main.tsx` owns the scenario editor, trace, strategy switch, charts, sensitivity, and export. `server/model.ts` calculates baseline/heuristic; `server/optimizer.ts` and worker solve and verify the MILP; `server/index.ts` exposes demo, run, sensitivity, and optional EIA routes. React, Express, Zod, and HiGHS are existing dependencies. The overview and settings tabs are real states of the same workspace.

The seeded profile and tariff are synthetic. EIA can provide a normalized demand shape but is not a matching solar, wind, or tariff observation. The current baseline is 13 server tests and four browser flows; JavaScript was 79,815 gzip bytes before this pass. Solver work runs in a worker; adding chart libraries or memoization without measured need would add complexity.

## Feature and route inventory

- **Screen:** One workbench with overview/settings tabs, dispatch trace, cost comparison, accounting, energy/SOC curves, sensitivity, and export. No decorative pages or shared design-system package.
- **API:** `GET /api/health` and `/api/scenarios/demo`; `POST /api/run`, `/api/sensitivity`, and `/api/data/eia`. `/api/run` returns verified strategy intervals; EIA is optional.
- **Working controls:** Capacity/efficiency/reserve/tariff/renewable settings, CSV import, optional EIA load shape, run, strategy switch, interval slider, capacity sensitivity, and JSON export.
- **Presentation only:** Brand/avatar and icons. Dispatch, comparison, and chart values come from the same scenario/result state, not simulated telemetry.
- **Constraint:** The solver is bounded to 168 intervals and its worker is the expensive operation. No measured client bottleneck justifies a chart dependency or additional caching.

## Priorities and acceptance

- **P1 completed:** Slider and chart selection produce one interval index; both charts mark it and the inspector displays the corresponding API result. Test the index and marker after a chart click.
- **P2:** Preserve truthful optimizer/heuristic labels, mobile chart readability, independently checked feasibility, and CSV/API error handling.
- **Out of scope:** Grid equipment control, market offers, and savings claims need hardware, tariffs, and operational validation.
