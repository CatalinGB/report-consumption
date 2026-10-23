# Home Assistant — Report Consumption (MQTT schema 3)

MQTT carries meter data only. Home Assistant owns orchestration: who is
notified, how a provider submission is performed, private contract data and
automatic sensor sources. In schema 3 the retained config must **not** contain
`notifications`, `meters[].notify`, `meters[].reporting`,
`meters[].source.entity_id` or `meters[].forwarding`. The only behaviour hint
left in MQTT is `meters[].reading_mode: manual|external`.

The browser app in this repository normalizes and publishes schema 3, including
`reading_mode` and the non-retained `event/index` notification event. Deploy this
package only after the retained config has been migrated to schema 3; legacy
`reporting` values are still accepted for one migration cycle.

## Roles

| Role | Who | Delivery in this package |
|---|---|---|
| **Index submitter** | Reads one or more meters and submits the index | ntfy (generic, PII-free) |
| **Company submitter** | Account owner/operator; reviews and authorizes submissions | Pushover to `kalioPhone` (`script.notify_admin`) |

`submitted_by` uses `index_submitter`/`company_submitter`; HA also accepts the
legacy `reporter` value during migration. Route targets likewise accept legacy
`mother`/`reporter` as `index_submitter` and `admin` as `company_submitter`.
Tokens remain transport credentials and are not role names in HA.

## 1. Files and import order

Import or include these in order:

1. [`helpers.yaml`](helpers.yaml) — optional YAML definition of
   `input_boolean.publicare_companie` (or create it once through **Settings →
   Devices & services → Helpers**).
2. Your private copy of [`meter_operations.example.yaml`](meter_operations.example.yaml)
   — creates `sensor.meter_operations`. **Never commit the filled-in copy.**
3. [`ntfy_notify.yaml`](ntfy_notify.yaml) — alias `ntfy_notify`, so a UI import
   creates `script.ntfy_notify`.
4. [`notify_admin.yaml`](notify_admin.yaml) — alias `Notify admin`, so a UI
   import creates `script.notify_admin`.
5. [`company_send_email.yaml`](company_send_email.yaml) — alias
   `company_send_email`, so a UI import creates `script.company_send_email`.
6. [`notify_index_submitter.yaml`](notify_index_submitter.yaml) — alias
   `notify_index_submitter`, so a UI import creates the ntfy reminder wrapper.
7. The automations: [`meter_reminders.yaml`](meter_reminders.yaml),
   [`close_alert.yaml`](close_alert.yaml),
   [`new_index_notify.yaml`](new_index_notify.yaml),
   [`company_preflight.yaml`](company_preflight.yaml),
   [`company_submit.yaml`](company_submit.yaml),
   [`water_sent_watcher.yaml`](water_sent_watcher.yaml).

If you load scripts from `configuration.yaml`, key them explicitly so the
entity id cannot drift with the alias:

```yaml
script:
  ntfy_notify: !include ha/ntfy_notify.yaml
  notify_admin: !include ha/notify_admin.yaml
  notify_index_submitter: !include ha/notify_index_submitter.yaml
  company_send_email: !include ha/company_send_email.yaml
```

The aliases above also make a UI import deterministic.

## 2. Private mapping — `sensor.meter_operations`

The only HA orchestration input is a private template sensor. The public
repository contains an example with placeholders only:

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
          company:
            electricity-a:
              mode: approve
              number_entity: number.example
              submit_button: button.example
              citire_entity: sensor.example_citire
              index_entity: sensor.example_index
          sources:
            water-a: sensor.example_water_index
```

- `routes.<meter>.target` — `index_submitter` or `company_submitter`. Missing
  entries default to `company_submitter`.
- `company.<meter>` — `mode: none|approve|email`, provider entities, SMTP
  notify entity, contract holder, contract address, client code and centre. `none`
  means HA never proposes or submits that meter.
- `sources.<meter>` — the current-index entity for a meter reported outside the
  form. Only the water sent watcher reads it; it never publishes to the company.

The real values live in a private HA file/helper, never in MQTT and never in
Git. The template sensor derives its entity id from the name `Meter operations`.
If HA creates `sensor.meter_operations_2`, every automation sees an empty
mapping: rename or fix the duplicate before relying on it.

`input_boolean.publicare_companie` remains the hard gate for the final company
submission. `initial: false` returns it to **suppressed** after every restart.
Suppression never blocks readings, reminders or notifications.

## 3. MQTT discovery

Publish the retained discovery payloads under
`homeassistant/sensor/<object>/config`. The files are in
[`discovery/`](discovery/):

| File | Entity | State topic |
|---|---|---|
| `meters_config.json` | `sensor.meters_config` | `meters/casa/config` |
| `submission_electricity_a.json` | `sensor.submission_electricity_a` | `meters/casa/last/electricity-a` |
| `submission_water_a.json` | `sensor.submission_water_a` | `meters/casa/last/water-a` |
| `submission_water_c.json` | `sensor.submission_water_c` | `meters/casa/last/water-c` |
| `submission_electricity_b.json` | `sensor.submission_electricity_b` | `meters/casa/last/electricity-b` |
| `submission_gas_a.json` | `sensor.submission_gas_a` | `meters/casa/last/gas-a` |
| `company_status_electricity_a.json` | `sensor.company_status_electricity_a` | `meters/casa/status/electricity-a/+` |
| `company_status_electricity_b.json` | `sensor.company_status_electricity_b` | `meters/casa/status/electricity-b/+` |
| `company_status_gas_a.json` | `sensor.company_status_gas_a` | `meters/casa/status/gas-a/+` |
| `company_status_water_c.json` | `sensor.company_status_water_c` | `meters/casa/status/water-c/+` |

The company status entity is required for a meter in `company` mode
`approve`/`email`: the submit automation verifies the retained proposal through
it. Add a matching discovery file when you add a meter.

The submission sensor state is the last reported period. A retained
`period: "reset"` marker means the meter has no current submission; HA treats it
as known and a reminder may fire for the open window. If the sensor is missing,
`unknown` or `unavailable`, HA treats the meter as **unknown**, not as
unreported, and sends no reminder.

## 4. Reminders and close alert

[`meter_reminders.yaml`](meter_reminders.yaml) runs at **10:00**:

1. Reads `sensor.meters_config` and `sensor.meter_operations.routes`.
2. Skips `reading_mode: external` meters.
3. Calculates the current or previous window, including cross-month windows and
   exact open/close times.
4. Reads `sensor.submission_<meter>`; only a known, different period is due.
5. Routes `index_submitter` to `script.notify_index_submitter` (generic ntfy) and
   `company_submitter` to `script.notify_admin` (Pushover to `kalioPhone`).

The index-submitter reminder carries the bare reporter page with the action
label **Open index reporting page**. The admin reminder uses Pushover and may
contain operational detail. A `continue_on_error` on each notification means one
dead device cannot abort the remaining meters; a malformed meter is skipped by
the per-item guards.

[`close_alert.yaml`](close_alert.yaml) runs at **10:05**, skips external meters,
and alerts the company submitter only when a window closed in the last 24 hours
and the meter is still unreported. Unknown submission sensors are ignored.

## 5. Notifications

**Privacy rule:** index-submitter ntfy messages are generic and PII-free. Admin
Pushover messages may contain operational detail but never a physical/contract
address. Use bare page URLs only; the app shows details after login.

`script.notify_index_submitter` sends the generic ntfy reminder for the index
submitter. `script.notify_admin` sends operational detail to Pushover on
`kalioPhone` and does not send to ntfy. The ntfy path is:

```text
script.notify_index_submitter -> script.ntfy_notify
  -> meters/casa/status/ntfy -> local listener -> ntfy.sh
```

The ntfy topic stays on the listener host; it is not in HA or Git. The envelope
includes `action_label`, mapped to a native ntfy action button. The
index-submitter message is generic and carries only the bare reporter link with
the **Open index reporting page** action.

Pushover is the admin channel and may contain meter/index/period/status detail,
but never a physical or contract address. If Pushover fails, `notify_admin`
raises an error instead of silently reporting success. Callers inside a loop use
`continue_on_error: true` so one failure cannot abort the loop. See
[`docs/notifications.md`](../docs/notifications.md).

## 6. New-index notification

[`new_index_notify.yaml`](new_index_notify.yaml) subscribes to
`meters/casa/event/index` at QoS 1 (non-retained). It accepts
`submitted_by: index_submitter` and legacy `reporter`, and notifies the company
submitter through `script.notify_admin` with the meter, house, index, period
and a link labelled **Open administration**.

This is the user → admin notification. `company_preflight.yaml` no longer sends
its own new-index message; it only writes the retained proposal. The event is
published by the index submitter after a successful submission in the current
browser build.

## 7. Company preflight and submission

[`company_preflight.yaml`](company_preflight.yaml) triggers on a new
`meters/casa/last/+` pointer (no short freshness gate, so offline-queued submissions are still processed). It writes a retained `proposed` status only when:

- `company.<meter>.mode` is `approve` or `email`;
- the status is not already `accepted`, `forwarded`, `suppressed` or `sending`
  for the same period;
- it is not an `error` marked `uncertain`;
- the last topic suffix, submission sensor period and index attribute agree.

It never submits to the company and never notifies.

[`company_submit.yaml`](company_submit.yaml) consumes a non-retained
`meters/casa/command/<meter>/<period>` command at QoS 1. Approval requires:

- the retained status is still `proposed`, same period, same numeric index;
- the command has a numeric `index`, a parseable `at` within 10 minutes, and
  the proposal was created before the command;
- the global gate is on;
- for provider mode, `citire_entity` says the company window is open;
- for e-mail mode, the meter has a window and the current date **and time** is
  inside that period's window; a proposal with `range_state: refuse` is
  rejected; `ok`, `unknown` and `warn` are allowed only through the explicit
  approve command.

Suppress is always safe and durable: it writes a retained `suppressed` status
with `cancelled_at`. A later approve for the same period sees `suppressed` and
stops. Suppress refuses to overwrite `accepted`/`forwarded`, so it cannot hide a
send that already happened.

Provider mode sets the number, waits 2 seconds, presses the button and waits up
to 45 seconds for `index_entity`. If `index_entity` is the same entity as
`number_entity`, HA cannot confirm the company index and records `forwarded`,
never a false `accepted`.

E-mail mode writes a retained `sending` status before calling
[`company_send_email.yaml`](company_send_email.yaml). The helper performs the
SMTP send and writes `forwarded` only after the service call returned. If the
helper fails or the status is not confirmed within 30 seconds, the automation
writes `error` with `uncertain: true` and notifies the company submitter.
`uncertain` proposals are not re-proposed automatically: verify the mailbox
before any manual retry.

Suppression and approval are serialized by `mode: queued`. A suppress command
cannot interrupt a submission that is already executing, but it is durable and
any approve that starts afterwards is refused. See
[`docs/catd-email.md`](../docs/catd-email.md) for the CATD-specific guard rails.

## 8. Water sent watcher

[`water_sent_watcher.yaml`](water_sent_watcher.yaml) listens to `state_changed`
events and resolves the entity through `sensor.meter_operations.sources`. It
notifies only; it never sets a provider entity or publishes a submission. It
ignores unknown/unavailable values and reports the first real value as
"prima valoare".

## 9. Recovery and testing

There is no `script.publish_meter_discovery` in this package. Republish the
retained discovery payloads from `ha/discovery/` after a broker loss, for
example with MQTT Explorer or:

```bash
mosquitto_pub -h <broker> -r \
  -t homeassistant/sensor/submission_water_c/config \
  -f ha/discovery/submission_water_c.json
```

Replace `<broker>` and use an account with publish rights on
`homeassistant/#`. The files are public placeholders; the broker credentials
are not.

Without waiting for 10:00, run the reminder automation manually while a window
is open and the meter is unreported. Publish a submission to
`meters/casa/last/<meter>` and run it again: no message for that meter. Publish
an `event/index` event to exercise `new_index_notify`. Test the company path
only with the global gate off first, then with a test meter whose provider
mapping is known. Never send a placeholder message to a real provider.

## 10. What is deliberately not here

- A live deployment/migration of the retained schema-2 config and the private mapping.
- Unattended submission without an explicit approve command and the gate.
- Offsite backup, bridge provisioning, or Flespi token rotation.
