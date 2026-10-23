# Report Consumption

A static, Romanian-first PWA for household electricity, water and gas indexes.
The browser publishes to **MQTT**; MQTT is the source of truth. A Home Assistant
consumer sends notifications, monitors smart-meter values and can optionally
submit readings to a provider integration.

No backend. No database. The page never reads Home Assistant at runtime.

## Features

- **Reporter page** — house-grouped meter cards, reporting-window logic,
  expected-range checks, optional photo, offline queue and corrections.
- **Company submitter console** — houses, meters, reading mode, seasonal gas
  profile, manual readings, history and photo viewer.
- **MQTT contract** — data-only retained config, one submission per
  meter+period, a `last/<meter>` pointer, photos, a new-index event and company
  status/command flow.
- **Home Assistant** — private notification/provider mapping, reminders,
  smart-water watcher, close alert, company preflight, explicit approve/suppress
  and a bridge heartbeat.
- **Notifications** — the index submitter uses a local MQTT-to-ntfy listener
  (generic, PII-free); the company submitter uses Pushover on `kalioPhone` with
  operational detail. The ntfy topic stays in a gitignored local file.
  See [`docs/notifications.md`](docs/notifications.md). The decision-ready user flows are in
[`docs/user-flows.md`](docs/user-flows.md).
- **Multi-house** — one installation can contain several houses; the reporter
  sees only the houses/meters marked visible.
- **Safety** — a global company-publishing switch defaults to suppressed, and a
  provider submit requires both the switch and the provider reading window.

## How a reading is judged

```text
days                 = max(1, days since the last reading)
expected_consumption = typical × days / 30
expected_index       = last_index + expected_consumption
normal band          = expected_index ± warn margin
refusal band         = expected_index ± refuse margin
```

Margins can be absolute or percentage. A warning needs confirmation; a refusal
is blocked. A first reading is accepted without a range; an index below the
baseline requires an explicit reset. See `js/anomaly.js`.

## Houses and meters

The config contains `houses[]` and `meters[]`; every meter has a `house_id`.
Reporter visibility is the combination of `house.visible` and `meter.visible`.
The admin always sees every house and meter.

Per-meter reading mode:

- `manual` — the index submitter enters the reading;
- `external` — HA/smart-meter supplies the index; the reporter page shows no form.

Notification routing and provider mappings are HA-only and never appear in MQTT.

Reporting windows are monthly open/close day+time in `Europe/Bucharest`; a window
may cross the month boundary. A late submission is accepted and flagged.

## Seed and private configuration

`config/seed.json` is a **generic example** (House A/B, placeholder entities).
The real production seed, tokens, provider entity mappings and deployment notes
belong outside this repository:

```text
config/seed.local.json   # ignored
.env.tokens              # ignored
ha/flespi-bridge.conf    # ignored
```

The live config is the retained MQTT topic; the seed only bootstraps an admin
session.

## MQTT

Topics use `meters/<installation>/...`. See
[`docs/mqtt-contract.md`](docs/mqtt-contract.md) for the full config, submission,
status and command payloads.

Roles:

- **Index submitter** (`reporter` token) — reads meters and submits indexes;
- **Company submitter** (`admin` token) — reviews, configures and authorizes
  company submission;
- **home bridge** — subscribe all, publish status.

See [`docs/mqtt-schema-v3.md`](docs/mqtt-schema-v3.md) for the clean schema.

Browser tokens are origin-locked to the Pages origin. Never commit tokens.

## Local development

```bash
bash tools/certs/generate.sh
cd tools/broker && npm install && node server.js
# browser tests need empty-password mode:
# MQTT_ALLOW_EMPTY_PASS=1 node server.js
cd ../..
python3 -m http.server 8091
```

Open the reporter with a local token and broker:

```text
http://localhost:8091/#installation=demo&token=<local-user>&broker=ws://localhost:8083
```

## Tests

```bash
npm test          # anomaly, period, schema
npm run e2e       # local browser + MQTT
npm run e2e:multi # houses, admin Citiri, admin submission
BASE_URL=https://YOUR_GITHUB_USER.github.io/report-consumption/ \
  node tests/e2e-flespi.js  # real Flespi + deployed Pages; reads .env.tokens
```

The local tests use a generated test-only CA and an in-memory Aedes broker.

## Home Assistant

The importable package and sensor discovery are under `ha/`. The real deployment
uses the private `sensor.meter_operations` mapping in HA, not in MQTT or this
public template. See [`ha/meter_operations.example.yaml`](ha/meter_operations.example.yaml).

The optional operations flow is:

```text
reading -> event/index notification -> proposed status -> company submitter
approve/suppress -> provider number/button or SMTP
```

The global helper `input_boolean.publicare_companie` defaults to **off =
suppressed**. Suppress is durable. A provider submit also requires the HA
reading-window sensor and a non-empty private mapping.

See [`ha/README.md`](ha/README.md), [`docs/runbook.md`](docs/runbook.md) and
[`docs/catd-email.md`](docs/catd-email.md) for the CATD water e-mail path.

## Deployment

1. Create the GitHub Pages repository with this static tree.
2. Provision Flespi ACL tokens: reporter, admin and home bridge. Keep keys out of
   git.
3. Render the bridge config with `node tools/render-flespi-bridge.js`, copy it to
   the Mosquitto host, and restart Mosquitto.
4. Publish the schema-3 config from the company submitter page.
5. Create the private HA `sensor.meter_operations` mapping and import the HA
   package and discovery.
6. Run one real reporting cycle.

## Security

- Reporter token in `localStorage`; admin token in `sessionStorage`.
  `localStorage` is shared by every project on the same Pages host; use a
  dedicated Pages host if the reporter token must be isolated.
- Strict CSP; vendored MQTT.js; no third-party scripts.
- Tokens and identifiers are never in notification URLs. ntfy is generic and PII-free; Pushover may contain operational detail but never an address.
- Readings stay in MQTT/HA. ntfy reminders are generic and contain no readings;
  Pushover may contain operational detail for the admin. Use self-hosted ntfy
  if even generic notification metadata must not leave the network.
- `.env*`, real seeds, rendered bridge configs, backups and private planning are
  ignored in the working tree and must not be committed. Keep an external backup
  before destructive git operations.
- Rotate tokens by creating a new token, verifying it, then deleting the old one.

## License

MIT © Report Consumption contributors
