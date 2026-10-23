# Testing — Report Consumption

## Unit tests

```bash
npm test
```

- `tests/anomaly.test.js` — expected range, normal/refuse margins, proration,
  first reading, meter reset, water decimals, invalid values.
- `tests/period.test.js` — same-month and cross-month windows, late periods,
  upcoming periods, already-reported periods, no-window meters.
- `tests/schema.test.js` — house grouping/visibility, seasonal gas profile,
  percent thresholds, migration fallback and config validation.

All pass as of 2026-10-18.

## Browser + MQTT end-to-end

Prerequisites:

```bash
bash tools/certs/generate.sh                        # test-only certs, ignored
cd tools/broker && npm install && node server.js   # TLS 8883, WSS 8084, WS 8083
python3 -m http.server 8091                         # from the repo root
npx playwright install chromium                     # once
```

Then:

```bash
npm run e2e
npm run e2e:multi
```

`tests/e2e-browser.js` publishes a self-contained test config (30-day-old
baseline), then verifies:

- the reporter page renders the meter and the expected-range hint;
- a value far outside the refusal band disables the submit button;
- a valid value submits and the toast appears;
- the retained `meters/casa/last/elec-test` pointer contains the new index;
- the admin page loads the config, changes `typical_month`, publishes it and the
  retained config reflects the change;
- both pages have **zero console errors**.

The test uses the local Aedes broker and the plain WS listener, so it does not
depend on a cloud broker or on a browser trusting the test CA.

`npm run e2e:multi` publishes `config/seed.json` and verifies the reporter sees
only `electricity-b` under the House B heading, while the admin shows both houses
and the gas Citiri form; smart water is excluded from Citiri. It also submits an
`electricity-a` reading through the admin Citiri form and checks the retained
`last/electricity-a` payload has `submitted_by: admin`.

## Manual E2E evidence (2026-10-17)

Before the repeatable harness existed, the same flows were driven manually through
the browser MCP against the local broker:

- **Reporter:** config render; last index/typical/expected range; ok, warn
  (confirmation required), refuse (submit disabled) and rollover (reset
  confirmation) states; first reading.
- **Submission:** retained `submission/elec-test/2026-10` written; toast “Indexul
  a fost trimis.”; history row; correction overwrote the same topic; late water
  submission for September was accepted with `late: true`.
- **Photo:** a 1600×1200 JPEG was resized/compressed to ~13 KB in the browser,
  previewed, published to `photo/elec-test/2026-10` (17 KB base64), and the
  submission carried `photo: true`.
- **Offline queue:** with the broker stopped, a submission showed “Salvat local”
  and landed in `rc.queue`; after the broker restarted, it was flushed, the toast
  said “Raportările din așteptare au fost trimise”, and the retained topic held
  the queued index.
- **Admin:** loaded the config, edited `typical_month` and published; retained
  config updated; publish status stayed “Publicat”; history table showed the
  submission and the late/corrected flags; on-demand photo view opened the
  retained photo.
- **Public Pages:** `https://YOUR_GITHUB_USER.github.io/report-consumption/` and
  `admin.html` loaded with zero console errors.

## Production Flespi + Pages

```bash
node tools/flespi-mint-tokens.js     # once; reads the master token, never prints keys
BASE_URL=https://YOUR_GITHUB_USER.github.io/report-consumption/ \
  node tests/e2e-flespi.js           # real Flespi + deployed Pages
```

The minting script creates three ACL tokens (reporter, admin, home), writes the
keys to `.env.tokens` with mode 600 (gitignored), and prints only names, ids,
origins and key lengths.

`tests/e2e-flespi.js` reads `.env.tokens` and runs the real path:

- **backs up the current retained config** before changing anything;
- publishes a temporary config to `meters/casa/config` with the admin token;
- opens the deployed Pages reporter with the reporter token, checks the expected
  range, refusal, a valid submission, the photo upload and the retained
  `last/elec-test` pointer through the home token;
- opens the deployed admin page with the admin token, edits and publishes the
  config, and verifies the retained config through the home token;
- deletes the test submission, photo and pointer, and restores the exact config
  it found at the start — never a public seed file.

Result on 2026-10-17: **passed**. This exercised the real Flespi broker, the
scoped ACLs, the origin lock, the live GitHub Pages app, the photo path and the
admin publish path. Errors are redacted before printing.

On 2026-10-18 the schema-2 config was published to the live broker and the
production Pages build was checked with the real reporter/admin tokens.

- reporter sees only `electricity-b` under the **House B** heading;
- admin sees both **House A** and **House B**, and the gas **Citiri** card;
- zero browser console errors;
- the live `sensor.meters_config` reported `schema: 2` at that time; the
  current app writes schema 3 and `reading_mode`.

## Home Assistant

Live on the HA instance (2026-10-17):

- `sensor.meters_config` — state `updated_at`, full config in attributes.
- `sensor.submission_electricity_a` and `sensor.submission_water_a` — state is
  the last reported period, attributes are the full submission.
- `automation.meters_daily_reminder` — created from
  `ha/meter_reminders.yaml`, daily at 10:00, `script.notify_admin` (Pushover) for
  company-submitter meters and `script.notify_index_submitter` (ntfy) for
  index-submitter meters. The route mapping is private HA state, not MQTT.
- MQTT discovery payloads are in `ha/discovery/`.

The window/period Jinja was extracted from the YAML and rendered offline with
Jinja2 across:

| Case | Expected |
|---|---|
| cross-month window on Oct 29 | due, period 2026-10, close 02.11 |
| cross-month window on Nov 1 | due, period 2026-10, close 02.11 |
| cross-month gap on Oct 17 | not due |
| same-month window on Oct 22 | due, period 2026-10, close 25.10 |
| same-month after close on Oct 26 | not due |
| period already reported | not due |
| day 31 clamped in February | due with a 28.02 close |

All cases passed.

**Live automation test:** with a temporary config whose electricity window was
open, a manual run notified `electricity-a` and skipped the water meter. After
publishing a test submission for the period, a second run showed `due=false` for
both meters and made no notification call. The test submission and sensor state
were cleared, and the production seed was restored.

The HA test used the owner's Pushover account/device and the local ntfy listener.
The mother's phone is not onboarded yet.

**Still missing:** the mother’s ntfy subscription and the one real reporting
cycle. The Flespi ↔ home Mosquitto bridge is now connected.

### Company command and healthcheck (2026-10-18)

- A non-retained `suppress` command for `electricity-b/2026-10` produced
  `sensor.company_status_electricity_b = suppressed` and was reset to `idle`.
- An `approve` command with the global switch off produced `blocked` with
  `detail: global publishing switch is suppressed`; no company number/button was
  touched.
- A retained `proposed` status rendered in the production admin **Propuneri
  companie** table with **Aprobă**/**Suprimă**; pressing **Suprimă** produced
  `sensor.company_status_electricity_b = suppressed`. The test status was reset
  to `idle`.
- `npm run healthcheck` returned `bridge healthcheck: OK` using the retained
  HA heartbeat forwarded through the bridge.
- The close-alert automation was run manually; it completed with no errors and no
  false alert (no window had closed in the last 24h).

## Local MQTT backup

```bash
npm run backup
```

`tools/export-mqtt.js` uses the home token to subscribe to
`meters/casa/#`, waits for the retained set, and writes a mode-600 JSON file
under `backups/` (gitignored). The first live export on 2026-10-18 wrote 3
retained topics. Offsite backup is deliberately deferred.

## Not covered

- The Mosquitto bridge between Flespi and the home broker.
- A real ntfy reminder delivery to the mother’s phone (only the owner’s Pushover
  device was tested).
- One real reporting cycle.
- The admin close-alert.
- Corrections after a window closes from the reporter UI (admin-side correction
  is not built).
- Scripted photo/offline-queue tests (photo is in the production E2E; the offline
  queue is covered manually above).
