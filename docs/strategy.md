# Technical strategy

Niche: an auditable single-bus battery-dispatch benchmark comparing a mathematical optimizer with a transparent heuristic. Target users are students and analysts learning small microgrid scenarios. The contribution is the MILP plus independent feasibility checking and matched capacity sensitivity—not a real-time grid controller.

| Direction | CS | Domain | Useful | Distinct | Feasible | Verifiable | Accessible | Interview | Total / 40 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| MILP vs heuristic dispatch benchmark **selected** | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 39 |
| Multi-technology capacity expansion | 5 | 5 | 4 | 3 | 2 | 4 | 5 | 4 | 32 |
| Robust dispatch under uncertain forecasts | 5 | 4 | 4 | 4 | 2 | 3 | 4 | 5 | 31 |

Alternatives: [PyPSA](https://docs.pypsa.org/latest/) and [Calliope](https://calliope.readthedocs.io/en/stable/) handle broader spatial, temporal and multi-technology energy models; [NREL REopt](https://www.nlr.gov/reopt/about/capabilities) provides renewable/storage planning and optimal dispatch; [HiGHS](https://highs.info/) is a general LP/MIP/QP solver. A solver alone is not a project contribution. This small benchmark differentiates through an understandable baseline, same-input comparison, independently recomputed constraints and sensitivity.

Technical proof: SOC recurrence/efficiency, power balance, reserve/capacity, charge/discharge and import/export exclusivity, terminal SOC restoration, analytic two-period and zero-capacity fixtures, independent schedule verification, optimizer-vs-heuristic sensitivity, solver status.

Scope: perfect foresight, single bus, simplified tariff; no network physics, degradation, demand charges, ancillary markets, or operational savings claims. Energy and power change together in the capacity sweep.
