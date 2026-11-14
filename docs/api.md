# API (M5a) - DRAFT

Read-only Express API in `api/`. Tier T0 (read). Isolation is enforced by Postgres roles and row-level security on the `serving` schema, not by application code. This page is filled in as the slice is built.

## Org model (assumption)
Orgs do not exist in the simulator. `dbt/seeds/org_map.csv` maps owners O01-O03 to ORG1 and O04-O06 to ORG2. Basis: assumption (`sim/config.yaml`, `n_orgs`).

## Roles
| Role | Sees |
|---|---|
| owner | own `owner_id` only |
| property_manager | own org |
| maintenance_coordinator | own org; work orders and S01/S02/S08 |
| leasing_manager | own org; leases and S03/S04 |
| data_owner | everything except `ground_truth` (all orgs, by design) |

## Status
Slice 1 of 7 (ADRs, org seed). Endpoints, SQL and tests are not built yet.
