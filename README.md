# GridOpt

GridOpt is an educational microgrid planning demonstrator. It compares a no-storage baseline with a transparent rule-based battery dispatch heuristic using the same hourly or subhourly scenario. It does not control grid equipment, submit market offers, or provide engineering or investment recommendations.

![GridOpt dashboard screenshot](docs/screenshot.png)

## Run locally

Requirements: Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:5173. The seeded example works without an account, API key, or external service. For production-style local preview, run `npm run build && npm start` and open http://localhost:3000.

Copy `.env.example` to `.env` only if you want to set an EIA key for the server. The app never needs a key to run its synthetic example. Do not commit `.env` or put API keys in source control.

## Architecture and model

- `src/` is a React/TypeScript responsive single-page dashboard. Charts are accessible inline SVG with text labels and units. Scenario inputs remain in browser memory; there is no account, database, or data retention.
- `server/index.ts` serves `/api/health`, `/api/scenarios/demo`, `/api/run`, and `/api/data/eia`, applies request limits and security headers, and serves the built client.
- `server/model.ts` validates the scenario, computes the baseline and heuristic dispatch, and independently recalculates interval balance and SOC feasibility before returning results.
- The optimizer is intentionally a deterministic rule-based heuristic, not a mathematical optimizer or solver. It charges renewable surplus first, grid-charges at the lowest 35th-percentile tariff threshold, and discharges at the highest 75th-percentile threshold when there is a deficit. Threshold ties are inclusive. The horizon input is treated as known; this is not a forecast. It may miss a lower-cost schedule.
- Solver and license: GridOpt does not use a third-party solver; the rule-based method is project code, so there is no solver license to install.
- The initial SOC is set as a share of energy capacity and must meet the reserve. The final SOC has no terminal target or terminal value; it is shown in the results. Compare costs only alongside final SOC and the stated tariff.

### Units and constraints

| Quantity | Unit | Convention |
|---|---|---|
| Load, generation, charge/discharge, import/export, curtailment | kW | Average power over each interval |
| Battery capacity, SOC, imported/exported/curtailed energy | kWh | Energy; SOC updates with interval duration |
| Interval duration | hours | Derived from validated, evenly spaced timezone-aware timestamps |
| Buy price and export price | USD/kWh | User/demo tariff values; illustrative unless supplied by the user |
| Round-trip efficiency | fraction | Split symmetrically as square-root charge and discharge efficiencies |

For interval duration `dt`, SOC updates as `SOC[t+1] = SOC[t] + charge[t] * sqrt(RTE) * dt - discharge[t] / sqrt(RTE) * dt`. Charge/discharge power, SOC, reserve, and interval balance are checked. The heuristic never charges and discharges simultaneously. Grid imports cover residual load, so unmet load is always zero in this model. With exports disabled, excess renewable power is curtailed; otherwise it is exported at the configured price. No terminal SOC policy is imposed.

The API accepts at most 168 intervals. Power capacities are nonnegative and bounded; input values must be finite. Battery energy and power capacity are separate fields and units.

## Data sources and provenance

### Synthetic example

The default 24-hour example is deterministic and generated in `server/index.ts`. Its name and source badge say **synthetic** in the dashboard and export. The profile is an illustrative summer day in UTC, with illustrative load, solar, wind, and time-of-use tariffs. It does not represent a particular place or customer.

### EIA hourly grid-demand profile

The optional integration queries the official [EIA API v2 hourly EIA-930 dataset](https://api.eia.gov/v2/electricity/rto/region-data/data/), selecting a balancing authority (MISO, PJM, NYIS, or CAISO) and the demand metric. EIA identifies the data as hourly demand, demand forecast, net generation, and interchange from Form EIA-930. The endpoint exposes UTC hourly and local-hourly frequencies; GridOpt requests UTC. EIA's returned demand is MWh in each hourly interval. The app uses the sequence only as a *shape*: it normalizes values to the example site's peak load, retains the observation timestamps, and explicitly labels the transformation. This is actual historical grid demand, not a site load or forecast. Importing it changes only the load shape; the current solar/wind profiles and tariff remain as configured and are still illustrative.

An EIA key is required for API requests. Register for a free key through [EIA Open Data](https://www.eia.gov/opendata/register.php); terms are on the registration page. Supply it in the password field for one request or configure `EIA_API_KEY` on the server. The key is not saved in browser storage, logs, or exports. Requests are limited to 24–168 hourly observations and time out. EIA data may be revised; the API identifies the source and observation times but this MVP does not archive a revision snapshot. If a request fails, the app reports the error and leaves the current source loaded. The user can explicitly retry or reset to the synthetic example.

### CSV input

CSV headers: `timestamp,load_kw,solar_kw,wind_kw,price_per_kwh`. Rows must contain nonnegative numeric values and ISO timestamps with `Z` or an explicit UTC offset. Times must be ordered and evenly spaced. Imports are limited to 168 rows and 2 MB. This intentionally small CSV reader accepts plain comma-separated fields and does not implement quoted commas. CSV is parsed in the browser and only sent to the local API when the user runs the scenario. Results export as JSON (not spreadsheet formulas) and contain assumptions, units, data provenance, model version, objective, interval outputs, and the feasibility-check result.

## Scope and limits

This is not validated for real dispatch, market bidding, or investment decisions. It omits battery degradation, thermal/inverter constraints, reserve and ancillary markets, network congestion, interconnection, forecast uncertainty, taxes, demand charges, and operational safety. It does not model emissions. A user tariff is not an actual wholesale price or a customer-bill estimate. A storage-cost difference in one illustrative horizon is not a savings promise.

No real-time control loop, stored credentials, persistent user records, or paid service are included. No remote weather source is used because it is not needed for the synthetic planning example.

## Security and privacy

- API accepts at most 256 KB JSON bodies, 168 intervals per run, and 90 requests per IP per minute. Four expensive jobs may run concurrently; inputs are bounded and the dispatch is linear in horizon size.
- Same-origin API only; no cross-origin access is enabled. Headers disable framing and content sniffing, restrict permissions and script sources, and conceal the Express signature.
- Errors returned to clients are scoped to validation/source issues. API keys and scenario data are not written to logs. No persistence is configured.
- CSV numeric columns and timestamps are validated before use. Export is JSON with safe download filename and no CSV/formula evaluation.
- Keep dependencies current and review `npm audit` output when updating them. CI installs exact lockfile dependencies.

## Checks and reproducible example

```sh
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run e2e
```

The unit fixture `server/model.test.ts` includes a one-hour, 2 kW import at $0.25/kWh, with expected energy charge **$0.50** and 2 kWh import. Numerical tolerances for independent interval balance and SOC recurrence are `1e-7` kW/kWh. Tests also cover charge/discharge efficiency, quarter-hour intervals, DST offset changes, zero generation/capacity, bounds, and invalid or uneven input. API tests cover health, demo-without-credentials, invalid requests, and missing EIA credentials. Browser smoke covers the example, settings edit, comparison, and result export.

## Deploy

`render.yaml` describes a single free-tier Render web service. To deploy, connect this repository to Render and use the included blueprint. The service uses Node 22, runs `npm ci && npm run build`, starts with `npm start`, and checks `/api/health`. EIA is optional; add a user-owned `EIA_API_KEY` in Render's environment settings to enable that integration. Render's free web services spin down when idle and have included bandwidth/build limits; review the current [free service terms](https://render.com/docs/free) before deploying because usage beyond included amounts may incur charges. A deployment has not been made or verified as part of this repository setup.

## Acceptance checklist

- [x] Seeded synthetic example works without credentials.
- [x] Battery settings, renewable/load scaling, CSV input, and optional EIA demand-shape import.
- [x] Baseline and rule-based comparison with interpretable power/SOC charts and objective notes.
- [x] Independent energy balance, SOC, power, reserve, and capacity verification before display.
- [x] Sensitivity view, source attribution, units, and JSON export.
- [x] API, CI, tests, documentation, responsive styling, and deployment blueprint.
- [ ] Live deployment: not performed; publish only after an operator connects the blueprint and verifies its URL.
