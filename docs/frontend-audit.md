# Frontend release audit — GridOpt energy dispatch studio

Checked 2026-10-23 against the previous committed redesign (`HEAD` before this release) and the current working build.

## Product and information architecture

- Primary user job: explore a labeled example, adjust or select the domain input, inspect a defensible result, and export enough provenance to reproduce it.
- Reading order: The interval trace leads; assumptions, comparison, accounting, curves, and model limits follow.
- Interaction corrected in this release: A visible strategy switch keeps the interval inspector, battery power curves, and SOC chart on the same optimized or rule-based result.
- Technical implementation: existing frontend and API architecture was retained. Unused sidebar selectors were removed. No new runtime dependency was added.

## Evidence

| Check                     | Result                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Previous build JavaScript | 79593 gzip bytes                                                                                                 |
| Current build JavaScript  | 79815 gzip bytes (+222)                                                                                          |
| Current build CSS         | 6106 gzip bytes                                                                                                  |
| Browser and API checks    | 13 server tests and 4 browser tests passed, including a result-value assertion and phone/tablet overflow checks. |
| Screenshots               | See the README linked desktop and mobile captures generated from the current browser flow.                       |

Bundle measurements sum the compressed generated `assets/*.js` and `assets/*.css` files. They do not measure first-load latency, network transfer on a specific host, or main-thread work. The previous build was reproduced from the prior commit in an isolated temporary checkout with the same installed dependencies.

## Accessibility and responsive review

- Core controls use visible labels or accessible names. The new selection state uses native buttons/slider controls or an explicit map clear button.
- Browser checks exercise the core flow and phone/tablet widths; existing full-page screenshots are kept with the repo.
- Data remain available in text, tables, or exports when charts or maps cannot be interpreted.
- A formal WCAG audit with assistive technology and automated contrast/axe tooling has not been completed. This remains a release follow-up before claiming accessibility conformance.

## Scientific and operational limits

The MILP is a planning model; it omits hardware safety, degradation, market and tariff details. No screenshot, synthetic example, or model output is evidence of field validation. Public hosting and external data availability are tracked in the README/deployment docs.

## Release checks

- [x] Displayed selection and chart/data agree in browser tests.
- [x] Existing unit/API tests and production build pass.
- [x] Responsive browser workflow passes.
- [ ] Repeat a manual screen-reader review and public-host latency measurement after deployment.
