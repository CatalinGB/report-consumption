# Runbook — Report Consumption

## Topology

```text
phone / browser
  -> Flespi MQTT over WSS
  -> Mosquitto bridge on the home host
  -> Home Assistant MQTT integration
  -> HA automations (reminders, review, company submission)
```

MQTT is the data source of truth for houses, meters, readings and submissions.
Home Assistant is a consumer and the orchestration operator. The static Pages
app never reads HA. In **schema 3** MQTT carries meter data only; notification
routes, provider entity ids, SMTP services and contract values live in a
private HA file, never in the retained config.

## Roles

| Role | Responsibility | Notification path |
|---|---|---|
| **Index submitter** | Reads meters and submits indexes for an assigned meter | ntfy (generic, PII-free) |
| **Company submitter** | Reviews proposals, edits configuration, authorizes company submission | Pushover to `kalioPhone` (`script.notify_admin`) |

The role labels are stable. Transport tokens are still named `reporter`/`admin`
in Flespi; the submission payload uses `submitted_by: index_submitter` or
`company_submitter`. HA also accepts legacy `reporter`/`admin` during migration.

## Normal operation

1. The company submitter publishes the retained schema 3 config from
   `admin.html`.
2. The index submitter submits a reading from the reporter page. The retained
   `last/<meter>` pointer is updated.
3. The index submitter publishes the non-retained `meters/casa/event/index`
   event. HA `new_index_notify` notifies the company submitter with the meter,
   house, index and period and a link labelled **Open administration**.
4. `company_preflight` writes a retained `proposed` status for meters whose
   private `company.<meter>.mode` is `approve` or `email`. It does not notify.
5. HA reminders run at 10:00. `index_submitter` meters call
   `script.notify_index_submitter` (generic ntfy); `company_submitter` meters call
   `script.notify_admin` (Pushover to `kalioPhone`). Reminders skip
   `reading_mode: external` meters.
6. The company submitter opens **Propuneri companie** and presses **Aprobă** or
   **Suprimă**. The app publishes a non-retained command.
7. Approve is blocked unless `input_boolean.publicare_companie` is on, the
   retained proposal is still current, and the company/window checks pass.
8. At 10:05 the close alert sends one admin message if a window closed in the
   last 24h and the meter is still unreported.

A submission for the period makes the next reminder and close alert skip that
meter. A late submission still counts. An unavailable or missing submission
sensor is treated as **unknown**, not as unreported, and produces no reminder.

## Private mapping (schema 3)

Schema 3 removes `notifications`, `meters[].notify`, `meters[].reporting`,
`meters[].source.entity_id` and `meters[].forwarding` from MQTT. The replacement
is one private HA template sensor, `sensor.meter_operations`:

```yaml
template:
  - sensor:
      - name: Meter operations
        unique_id: meter_operations_private
        state: "ok"
        attributes:
          routes:
            electricity-a:
              target: index_submitter
            water-c:
              target: company_submitter
          company:
            electricity-a:
              mode: approve
              number_entity: number.example
              submit_button: button.example
              citire_entity: sensor.example_citire
              index_entity: sensor.example_index
            water-c:
              mode: email
              smtp_service: notify.example_catd
              contract_holder: "<private>"
              contract_address: "<private>"
              cod_client: "<private>"
              center: "<private>"
          sources:
            water-a: sensor.example_water_index
```

See `ha/meter_operations.example.yaml` for the documented example. Copy it to a
private HA package, fill it in, and never commit or publish the filled copy.

- `routes.<meter>.target`: `index_submitter` or `company_submitter`. Missing
  entries default to `company_submitter`.
- `company.<meter>.mode`: `none`, `approve` or `email`. `none` disables both
  preflight and submission for that meter.
- `sources.<meter>`: current-index entity for external meters. Only the water
  sent watcher reads it, notification-only.

## Global company gate

```text
input_boolean.publicare_companie
```

- **off = suppressed**, the safe default.
- `initial: false` returns it to suppressed after every HA restart.
- It gates only the final company submission. Readings, reminders, water
  notifications and preflight proposals continue while it is off.
- It cannot stop a provider that submits outside HA.

Create it once, either through **Settings → Devices & services → Helpers** or
by importing `ha/helpers.yaml`. Do not define the same helper twice.

## Company submission

Flow:

1. `company_preflight.yaml` writes `proposed` only when `company.mode` is
   `approve`/`email` and the status is not already
   `accepted`/`forwarded`/`suppressed`/`sending` (or an `uncertain` error).
2. The admin page writes a non-retained, QoS 1 command to
   `meters/casa/command/<meter>/<period>`.
3. `company_submit.yaml` verifies:
   - the retained status is still `proposed`, same period, same numeric index;
   - the command `index` is numeric and the command `at` is at most 10 minutes
     old;
   - the proposal was written before the command;
   - the global gate is on.
4. Provider mode (`mode: approve`): check `citire_permisa`, write `sending`, set
   the number, wait 2 seconds, press the button and wait up to 45 seconds for
   the company index. If `index_entity` is the same entity as `number_entity`,
   the result is `forwarded` (verify manually), never a false `accepted`.
5. E-mail mode (`mode: email`): require a configured window and a full
   date + time + period check; reject outside the window; reject
   `range_state: refuse`; allow `ok`/`unknown`/`warn` only through the explicit
   approve command. Write `sending`, call `script.company_send_email`, and
   write `forwarded` only after SMTP returned. On failure write `error`
   (`uncertain: true`) and notify.
6. Status becomes `accepted`, `forwarded`, `blocked`, `error` or `suppressed`.

**Never turn the global switch on until the private mapping for that meter has
been verified.** `suppress` is always safe.

`suppress` writes a durable retained `suppressed` status with `cancelled_at`.
A later approve for the same period sees `suppressed` and refuses. Suppress
does not overwrite `accepted`/`forwarded`, so it cannot hide a send that already
happened. Commands are serialized by `mode: queued`; a suppress cannot interrupt
a send already in progress, but any approve that starts afterwards is refused.

### CATD e-mail safety

CATD-specific details are in [`catd-email.md`](catd-email.md). The short rule
is: no window, no send; no explicit approve, no send; no ambiguous retry after
an `uncertain` SMTP error without checking the mailbox first.

## Flespi tokens

- The reporter/admin tokens are origin-locked to the Pages origin.
- The home token is backend-only (`origins: []`).
- The master token is never used by a browser or HA.
- Rotate one token at a time; verify the new one before deleting the old.
- Current master work: create a new Flespi Master token, store it in the password
  manager, update the token-minting environment, and record the expiry date.
- The home bridge token rotation is `node tools/flespi-rotate-home.js`, followed
  by copying `ha/flespi-bridge.conf` to the Unraid path and restarting Mosquitto.

## Bridge

Live bridge file:

```text
/path/to/mosquitto/config/extensions/flespi-bridge.conf
```

Key directives:

```conf
try_private false
notifications false
```

`try_private true` uses Mosquitto's private bridge handshake and Flespi rejects
it. `notifications true` installs an LWT on `$SYS/broker/connection/...`, which
the scoped home token cannot publish. Both caused earlier `not authorised` /
`Topic Name invalid` errors.

Restart and inspect:

```bash
docker restart mosquitto
docker logs --tail 40 mosquitto | grep -Ei 'flespi|bridge|not author|topic'
```

The home broker should also have persistence enabled so retained discovery and
local messages survive a broker restart:

```conf
persistence true
persistence_location /mosquitto/data/
```

Mount `/mosquitto/data` as a persistent volume before relying on this.

## New-index notification

The index submitter publishes a non-retained, QoS 1 event:

```text
meters/casa/event/index
```

`ha/new_index_notify.yaml` accepts `submitted_by: index_submitter` or legacy
`reporter`, and calls `script.notify_admin` with meter/house/index/period and an
admin link labelled **Open administration**. It is the only user → admin new
index notification; `company_preflight` no longer duplicates it.

## ntfy notifications

```text
script.notify_index_submitter -> script.ntfy_notify
  -> meters/casa/status/ntfy (non-retained)
  -> Mosquitto bridge -> Flespi
  -> tools/ntfy-listener.js -> ntfy.sh/<local-topic>
```

Run the listener on an always-on host:

```bash
node tools/ntfy-listener.js
```

It reads `.env.ntfy` (mode 600, gitignored) and
`REPORT_CONSUMPTION_HOME_TOKEN` from `.env.tokens`. The ntfy topic never enters
Home Assistant or Git. Full setup and rotation are in
[`notifications.md`](notifications.md).

The envelope includes `action_label`. The listener sends it as an ntfy `actions`
entry so the index-submitter reminder shows a visible **Open index reporting
page** button.

If the listener is down, the index-submitter reminder is lost. The admin
Pushover path is independent. If Pushover fails, `script.notify_admin` raises
an error instead of reporting success; callers in loops use
`continue_on_error` so the loop continues.

## Health

```bash
npm run healthcheck
```

It reads `meters/casa/status/ha-heartbeat` from Flespi. HA publishes the
heartbeat every five minutes locally; the bridge must forward it. A stale or
missing heartbeat means HA → bridge → Flespi is broken.

Schedule it on the Unraid host, for example every 15 minutes, and notify on a
non-zero exit.

## Backup

```bash
npm run backup
```

Writes a mode-600 JSON export under `backups/` (gitignored). It contains config,
submissions, last pointers, status and photos. Keep at least until the next
reading cycle + 5 days; 13 months is the recommended default. Offsite backup is
deliberately deferred.

Restore is not automated yet; do not delete the Flespi retained topics before a
tested restore exists.

## Migration to schema 3

1. Read the existing schema-2 config.
2. Map `reporting: smart|sensor` to `reading_mode: external`; otherwise
   `manual`.
3. Copy `notify` targets into `routes`, `forwarding` into `company`, and
   `source.entity_id` into `sources` in the private HA file.
4. Drop `notify`, `reporting`, `source`, `forwarding` and `notifications` from
   the MQTT payload.
5. Publish schema 3 from the admin page. Keep the old config in a private
   backup until one full cycle succeeds.
6. Deploy this HA package after step 5. The browser app now normalizes and
   publishes schema 3; `event/index` is published after each successful
   index-submitter submission.
7. Create the private `sensor.meter_operations` mapping before enabling company
   submission; provider entities and contract data are not in MQTT.

## Common incidents

### Reporter page shows “Waiting for configuration”

- Check the bridge log for `not authorised` / `Topic Name invalid`.
- Verify `sensor.meters_config` in HA has a fresh `updated_at`.
- Verify the retained config has `schema: 3` and `meters[].reading_mode`.
- Republish the config from the admin page.

### Dashboard sensors missing after HA/Mosquitto restart

- Republish the retained discovery payloads from `ha/discovery/`, for example:

  ```bash
  mosquitto_pub -h <broker> -r \
    -t homeassistant/sensor/submission_water_c/config \
    -f ha/discovery/submission_water_c.json
  ```

- Use MQTT Explorer if `mosquitto_pub` is not installed.
- Enable Mosquitto persistence and mount its data volume.
- There is no `script.publish_meter_discovery` in this package; the JSON files
  are the recovery source.

### Reminder missing for an external meter

- Expected: `reading_mode: external` meters are skipped by the manual reminder
  and by the close alert.
- Check `sensor.meters_config` has the new field, not the legacy `reporting`.
- Check `sensor.meter_operations.routes` has the intended target; a missing
  route defaults to `company_submitter`.

### Reminder missing for a manual meter

- Check `sensor.submission_<meter>`: `unknown`/`unavailable` is treated as
  unknown and suppresses the reminder by design.
- Check the window open/close day and time.
- Check the automation trace; one malformed meter is skipped, not fatal.

### ntfy notification missing

- Check the listener log for `ntfy listener: sent ...` and MQTT connection
  messages.
- Check `script.ntfy_notify` and the automation trace; the script must publish
  to `meters/casa/status/ntfy`.
- Verify the phone is subscribed to the current topic after a rotation.
- The admin Pushover path is independent; a missing ntfy message means the
  index submitter may not have been reminded.

### Company button not available

- `citire_permisa` is false or the integration is outside its live window.
- The number/button entities are `unavailable`; the submission is blocked by
  design.
- Do not bypass this with a direct service call; wait for the provider window.
- If `index_entity` is the same as `number_entity`, a result of `forwarded` is
  expected; verify in the provider portal.

### E-mail attempt failed or is uncertain

- A retained `error` with `uncertain: true` means HA could not confirm the SMTP
  result. Check the CATD mailbox before any retry.
- Do not re-approve automatically; `company_preflight` refuses to overwrite an
  uncertain error. Confirm the mail was not sent, then clear the retained status
  (delete the status topic or publish a fresh `proposed` status) before a manual
  retry. `suppress` alone is durable and will not re-propose.
- A stuck `sending` means HA stopped between the SMTP call and the `forwarded`
  publish. Verify the mailbox before clearing it; do not assume it failed.
- `blocked` with `outside the email reporting window` means the full
  date + time + period check failed.

### Suppressed proposal still shows

- `suppress` writes a durable retained status. The admin page shows the retained
  state; refresh or reconnect if the badge is stale.
- An approve command for a suppressed period is refused.

### Reset a meter and restart the flow

The admin **Raportare → Reset raportare** action clears the known
`submission`, `status` and `photo` retained topics and replaces `last` with a
retained `reset` marker. The marker keeps the HA submission sensor known (so
reminders can resume) while failing `company_preflight` safely. The next reading
then starts the HA reminder/preflight/proposal flow again.

- It never undoes a provider-side submission.
- It refuses to reset when a status is `sending`, `accepted`, `forwarded` or an
  uncertain `error`; verify the provider portal first.
- The config baseline is not changed. Clear or correct it separately if the
  physical meter was replaced.
- If HA did not create a proposal after a manual reading, use **Reîncearcă HA**
  on the latest history row. This republishes `last/<meter>`; it does not create a
  second submission.

### Compatibility with the deployed reporter

The reporter page is already on the index submitter's phone. Keep invite links,
`localStorage` keys, installation ids, token roles and existing MQTT fields
working. New config fields must be optional with safe defaults, and legacy
`reporter`/`admin` roles and fields must remain accepted until the live data is
migrated. Test against the real retained config before deployment.

### Wrong reading

- Use the reporter/admin correction path for the same meter+period.
- A correction supersedes the company proposal.
- If already submitted to the company, verify the provider's correction process;
  the app cannot undo a provider-side submission.

### Phone offline / no reminder

- ntfy/Pushover delivery is external. The close alert still reaches the company
  submitter through Pushover.
- Check device notification permission and quiet hours.

## Still required before calling this mature

- Fill the private `sensor.meter_operations` with real routes/company/sources.
- Import `company_send_email` and publish the water-c status/submission
  discovery.
- Re-mint the reporter token to allow `event/index`, or use the current token
  only after its ACL is updated.
- Deploy the updated `ntfy_notify`, `notify_index_submitter` and `notify_admin`
  scripts, then restart the ntfy listener so `action_label` renders.
- Confirm the index submitter has the ntfy app subscribed to the topic.
- Set the real provider windows and baselines (kept private).
- Confirm the admin Pushover target is `kalioPhone`.
- Run the ntfy listener as a persistent service.
- Enable Mosquitto persistence.
- Create the new Flespi Master and rotation calendar.
- Run one real cycle across House B, gas and water.
- Decide whether offsite backup is needed.
