# MQTT contract — Report Consumption

Status: **draft for the MQTT contract ticket**. One installation is the tenant;
both browser roles and the later HA consumer share it. MQTT is the source of
truth; Home Assistant is never required at runtime.

## Tenant and credentials

- **Installation id** — a slug chosen once, e.g. `casa`. Every topic is under
  `meters/<installation>/`.
- **One Flespi account** holds the tokens. The account + installation id is what
  ties the client and admin roles; they do **not** share a credential.
- **Tokens** (created in Flespi by the owner, never in the page):
  - `reporter` (index submitter) — publish submissions/photos/events; subscribe
    config and submission state.
  - `admin` (company submitter) — publish/subscribe everything under the
    installation.
  - `home` — the Mosquitto bridge / HA consumer; subscribe everything, publish
    only status.
- Browser tokens are origin-locked to `https://YOUR_GITHUB_USER.github.io`. The reporter
  invite is `index.html#installation=casa&token=<reporter-token>`; the page strips
  it after saving to `localStorage`.

## Topics

| Topic | Retain | QoS | Writer | Readers | Purpose |
|---|---|---|---|---|---|
| `meters/<installation>/config` | yes | 1 | admin | reporter, HA | Versioned meter data: houses, meters, windows, thresholds, profiles. No HA entity names, routes, SMTP or contract data. |
| `meters/<installation>/submission/<meter_id>/<period>` | yes | 1 | reporter | admin, HA | One reading per meter per period. A correction overwrites the same topic. |
| `meters/<installation>/last/<meter_id>` | yes | 1 | reporter/admin | admin, HA | Retained pointer to the latest accepted submission for that meter. A `period: "reset"` marker means the meter has no current submission; HA treats it as known but not a real period. |
| `meters/<installation>/photo/<meter_id>/<period>` | yes | 1 | reporter | admin, HA | Optional photo, pure base64 (HA MQTT image entity). |
| `meters/<installation>/status/<meter_id>/<period>` | yes | 1 | HA | reporter, admin | Company state: proposed / approved / suppressed / blocked / forwarded / accepted / error. |
| `meters/<installation>/status/ntfy` | no | 1 | HA | local ntfy listener | Non-retained notification envelope; no topic or secret in the payload. |
| `meters/<installation>/event/index` | no | 1 | reporter | HA | Non-retained new-index event for HA notification routing. |
| `meters/<installation>/command/<meter_id>/<period>` | no | 1 | admin | HA | Explicit approve/suppress command; never retained so a replay cannot double-submit. |
| `meters/<installation>/client/status` | yes | 1 | reporter | admin | Last seen, page version, connection state. Optional. |

`<period>` is `YYYY-MM` in `Europe/Bucharest`. One topic per meter+period means
no history-array write race, idempotent retries, and corrections are overwrites.
History is the set of retained submission topics under `submission/#`; the page
and HA both subscribe and sort.

## Config payload (schema 3)

Schema 3 is intentionally data-only. The browser owns meter metadata and
readings; Home Assistant owns notification routing, provider mappings, SMTP and
contract data. See [`mqtt-schema-v3.md`](mqtt-schema-v3.md).

```json
{
  "v": 1,
  "schema": 3,
  "installation": "casa",
  "updated_at": "2026-10-20T18:00:00Z",
  "timezone": "Europe/Bucharest",
  "locale": "ro",
  "houses": [
    { "id": "house-a", "name": "House A", "order": 1, "visible": true }
  ],
  "meters": [
    {
      "id": "electricity-a",
      "house_id": "house-a",
      "name": "Electricity A",
      "kind": "electricity",
      "provider": "Provider A",
      "unit": "kWh",
      "consumption_unit": "kWh",
      "consumption_factor": 1,
      "precision": 0,
      "visible": true,
      "reading_mode": "manual",
      "baseline": { "index": 1000, "at": "2026-01-01" },
      "typical_month": 200,
      "typical_by_month": null,
      "window": {
        "type": "monthly",
        "open_day": 19,
        "open_time": "09:00",
        "close_day": 25,
        "close_time": "23:59"
      },
      "thresholds": {
        "mode": "absolute",
        "warn_margin": 50,
        "refuse_margin": 100
      },
      "photo": { "enabled": true, "max_kb": 512 }
    }
  ]
}
```

### Houses and per-meter metadata

- `visible` is a presentation flag. The admin always sees every house and meter.
- `reading_mode` is `manual` (index submitter may enter the index) or
  `external` (the index comes from HA/smart meter; the app shows no input form).
- `baseline`, `typical_month`, `typical_by_month`, `window`, `thresholds` and
  `photo` are meter data.
- `notify`, `reporting`, `source.entity_id`, `forwarding` and the top-level
  `notifications` object are **not part of schema 3**. They were moved to the
  private HA `sensor.meter_operations` mapping.
- `typical_by_month` is optional and keyed `"01"`…`"12"`; it takes precedence
  over `typical_month`.
- `consumption_unit` is the unit of `typical_month`/`typical_by_month`; it
  defaults to `unit`.
- `consumption_factor` is the number of consumption units per one index unit;
  it defaults to `1`. For a gas meter whose index is in m³ but whose seasonal
  profile is in kWh, set `unit: "m³"`, `consumption_unit: "kWh"` and
  `consumption_factor: 10.45`.
- `window.close_day` may be smaller than `open_day`; that means the window
  crosses the month boundary (e.g. 28 → 2). `window: null` means the meter accepts
  a submission at any time.
- `thresholds.mode` is `absolute` (default) or `percent`. In percent mode,
  `warn_pct`/`refuse_pct` scale expected consumption.
- The global HA switch `input_boolean.publicare_companie` is an HA-only gate for
  company publication and is never part of MQTT.

### Roles

- **Index submitter** — reads meters and submits indexes. Token role remains
  `reporter`.
- **Company submitter** — reviews submissions, edits configuration and
  authorizes company submission. Token role remains `admin`.

`submitted_by` is `index_submitter` or `company_submitter`; legacy
`reporter`/`admin` values are accepted by HA during migration.

## Expected range and anomaly states

All values are computed from the last accepted submission (or the seed baseline)
and the meter's `typical_month`/`typical_by_month`:

```
typical_index     = typical_consumption / consumption_factor
days              = max(1, days between baseline.at and now)
expected_consumption = typical_index × days / 30
expected_index    = baseline.index + expected_consumption
normal_low        = expected_index - warn_margin
normal_high       = expected_index + warn_margin
refuse_low        = expected_index - refuse_margin
refuse_high       = expected_index + refuse_margin
```

States:

- **ok** — inside `[normal_low, normal_high]`.
- **warn** — outside the normal band but inside `[refuse_low, refuse_high]`.
- **refuse** — outside `[refuse_low, refuse_high]`; cannot be published without
  an explicit override.
- **unknown** — no baseline, no typical consumption, or no baseline date. The
  first reading is accepted without a range.
- **rollover** — the index is below the baseline. The reporter must explicitly
  confirm a meter reset; the new index becomes the new baseline and the range is
  disabled until the next reading.

For a gas meter with `unit: "m³"`, `consumption_unit: "kWh"` and
`consumption_factor: 10.45`, a profile of `104.5 kWh/month` becomes
`10 m³/month` for the expected-index calculation.

Example (owner's numbers): baseline 1000 kWh, typical 200 kWh/month, 30 days,
`consumption_factor: 1`, margins 50/100 → expected **1200**, normal
**1150–1250**, refusal outside **1100–1300**. The owner's `1150–1300` span is from the warning-low to the
refusal-high; the warning-free band is narrower. Setting `warn_margin: 100`
widens the normal band to 1100–1300.

A refused value never becomes the baseline. A warning requires a confirmation
step but is then submitted and can become the baseline.

## Submission payload

```json
{
  "v": 1,
  "id": "01JABCDEF...",
  "installation": "casa",
  "house_id": "house-a",
  "meter_id": "electricity-a",
  "period": "2026-10",
  "index": 21870,
  "previous_index": 21680,
  "previous_at": "2026-09-21T09:00:00Z",
  "delta": 190,
  "submitted_at": "2026-10-17T18:05:12Z",
  "submitted_by": "index_submitter",
  "range_state": "ok",
  "photo": true,
  "late": false,
  "corrected": false,
  "reset": false,
  "client": {
    "tz": "Europe/Bucharest",
    "ua": "Mozilla/5.0 ..."
  }
}
```

- `id` is a client-generated ULID/UUID used for idempotency and for the photo
  topic name if needed.
- The page considers a submission **sent** when the broker acknowledged the
  publish (QoS 1 PUBACK) and the retained topic is writable. The visible state is
  `pending` until then.
- Every accepted submission is also written to `last/<meter_id>` (retained), so
  HA can read the latest period without subscribing to a wildcard of periods.
- A correction in the same period overwrites the same topic with a new
  `submitted_at` and the same `period`.

### Period, late submissions and corrections

- The **Period** is the `YYYY-MM` month in which the Meter's window **opens**, not
  the month of the submission. A window that crosses a month boundary (28th → 2nd)
  belongs to the month it opened in.
- A Meter with `window: null` accepts a submission at any time; its Period is the
  current month.
- If the submission arrives after the window closes, it is accepted with
  `late: true`. It still counts as reported and stops the reminders.
- If a submission already exists for that Meter and Period, the new one is a
  **correction**: it overwrites the retained topic and sets `corrected: true`.
  The latest submission for a Period wins.
- A refused reading never becomes a baseline. A warning requires an explicit
  confirmation in the page but can then be submitted.


## New-index event

`meters/<installation>/event/index` is a non-retained, QoS 1 event published by
the index submitter after a successful submission. It is data, not routing; HA
`new_index_notify` decides who to notify.

```json
{
  "v": 1,
  "id": "01JABCDEF...",
  "meter_id": "electricity-a",
  "period": "2026-10",
  "index": 21870,
  "submitted_by": "index_submitter",
  "submitted_at": "2026-10-17T18:05:12Z"
}
```

## Status payload (later HA)

```json
{
  "v": 1,
  "meter_id": "electricity-a",
  "period": "2026-10",
  "state": "forwarded",
  "updated_at": "2026-10-21T10:03:00Z",
  "by": "ha",
  "detail": "Provider A index set and submitted"
}
```

Allowed `state`: `proposed`, `approved`, `suppressed`, `blocked`, `forwarded`,
`accepted`, `error`. The page shows it as a badge; it never gates the reading.
`proposed` includes the index, `previous_index`, `previous_at`, `delta` and the
global `gate` value (`on`/`off`). `input_boolean.publicare_companie` must be
`on` before any final company submission.

## ntfy notification envelope

`status/ntfy` is a non-retained, QoS 1 envelope. HA publishes it; the local
listener reads it and forwards it to the local ntfy topic. The ntfy topic itself
is deliberately not part of this contract or the HA config.

```json
{
  "v": 1,
  "title": "Report consumption",
  "message": "A meter is ready",
  "priority": "high",
  "tags": "bell",
  "url": "https://example.invalid/",
  "at": "2026-10-20T18:00:00+03:00"
}
```

`priority` accepts `min`, `low`, `default`, `high`, `max` or `1`–`5`. The
listener ignores malformed or stale retained envelopes; a non-retained envelope
is intentionally not replayed when the listener is offline.

## Company command payload

The admin page publishes a non-retained command only after a proposal:

```json
{
  "action": "approve",
  "index": 1234,
  "by": "company_submitter",
  "at": "2026-10-18T12:30:00Z"
}
```

`action` is `approve` or `suppress`. The HA automation re-checks
`input_boolean.publicare_companie` and the company `citire_permisa` sensor before
setting the company `number` and pressing the submit `button`. A suppress
command only writes `state: suppressed`.

## Photo

- Pure base64 bytes only, no JSON envelope, because the HA MQTT image entity
  expects pure base64.
- Target ~1280 px q80 JPEG (≈250 KB), hard cap from `photo.max_kb`.
- Metadata lives in the submission (`photo: true`); the bytes live on the photo
  topic.
- Retained so the admin/HA see the latest; retaining one photo per meter+period
  also preserves history naturally. Delete a period by publishing an empty
  retained payload.
- If the photo fails after the index is accepted, keep the reading and set
  `photo: false`; never lose the reading over the image.

## HA consumption (later)

HA subscribes to `meters/<installation>/#` and:

1. Reads `config` for meter data, windows, thresholds and profiles.
2. Reads `submission/#` and `last/#` to know what is reported.
3. Reads the private HA `sensor.meter_operations` mapping for routes, provider
   entities, SMTP and contract data. Those values are never in MQTT.
4. Sends reminders while a window is open and no submission exists — never for
   a meter already reported. Routing is HA-owned.
5. Notifies the company submitter on `event/index` (new-index notification).
6. Maps `meter_id` to provider entities in HA, then writes
   `status/<meter_id>/<period>`.
7. Writes nothing to config; config is admin-only.

## Open points

- Whether the page writes `client/status` at all.
- Photo retention and deletion policy.
- History retention: retained submission topics accumulate one per meter per
  month; a cleanup routine may delete periods older than N years.
- Flespi ACLs: reporter publish on `submission/#`, `last/#`, `photo/#`, `event/index`;
  subscribe on `config`, `submission/#`, `last/#`, `status/#`; admin all; home
  subscribe all, publish `status/#`.
