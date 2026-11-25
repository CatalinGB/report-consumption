# Notifications — ntfy

Report Consumption sends index-submitter reminders to an
[ntfy.sh](https://ntfy.sh) topic straight from Home Assistant over HTTPS.
There is no MQTT hop and no listener process:

```text
HA script.notify_index_submitter
  -> script.ntfy_notify
  -> rest_command.ntfy_publish
  -> https://ntfy.sh/<topic>  (one POST, JSON body)
  -> phone
```

The admin (company submitter) is notified separately on Pushover through
`script.notify_admin`; that path never touches ntfy.

## Privacy rule

Never send PII to ntfy: no house or meter name, index, period, address,
contract/client code, token or installation id. The index-submitter message is
generic; the admin receives operational detail on Pushover. Links must be bare
page URLs with no query or fragment. Details are visible only after opening the
app.

## The topic is a secret

The ntfy topic is generated locally and is a bearer capability: anyone who
knows it can read the messages and publish to it. Keep it in:

- `.env.ntfy` on the machine that runs the CLI tools (mode 600, gitignored);
- the HA `secrets.yaml` key `ntfy_url` (the full publish URL).

Never put it in this repository, an MQTT topic, a dashboard, a notification, a
commit or an issue.

## 1. Create the topic

```bash
python3 - <<'PY'
import uuid
print("https://ntfy.sh/" + str(uuid.uuid4()))
PY
```

Save it in `.env.ntfy`:

```dotenv
NTFY_TOPIC=<uuid>
NTFY_URL=https://ntfy.sh/<uuid>
```

and in Home Assistant's `secrets.yaml`:

```yaml
ntfy_url: "https://ntfy.sh/<uuid>"
```

If the topic is exposed, generate a new UUID, update both places, and
resubscribe the phones. The old topic goes silent.

## 2. Subscribe on the phone

Install the ntfy Android/iOS app and subscribe to the topic (or open
`https://ntfy.sh/<topic>` once). The index submitter and the admin may both
subscribe; the same generic message reaches both.

## 3. Home Assistant configuration

Add the `ntfy_publish` command to the existing `rest_command:` block in
`configuration.yaml` — the snippet is in
[`ha/rest_command-ntfy.example.yaml`](../ha/rest_command-ntfy.example.yaml):

```yaml
rest_command:
  ntfy_publish:
    url: !secret ntfy_url
    method: POST
    content_type: "application/json"
    payload: >-
      ... (see the example file)
```

Reload REST commands after editing: **Settings → Tools → YAML → REST commands**
(or `rest_command.reload`). A restart is not needed.

HA must be able to reach `https://ntfy.sh` outbound on port 443.

## 4. Scripts

Import [`ha/ntfy_notify.yaml`](../ha/ntfy_notify.yaml) as a script named
`ntfy_notify`, then import
[`ha/notify_index_submitter.yaml`](../ha/notify_index_submitter.yaml) as
`notify_index_submitter`. The admin uses
[`ha/notify_admin.yaml`](../ha/notify_admin.yaml) for Pushover to `kalioPhone`.

`script.ntfy_notify` posts the message as the request body and sends the
metadata as headers:

| Header | Value |
|--------|-------|
| `Title` | `Raport consum` |
| `Priority` | `default` |
| `Tags` | `bell` |
| `Click` | bare page URL, e.g. `https://example.invalid/` |
| `Actions` | `view, Deschide pagina de raportare, https://example.invalid/, clear=true` |

The body is short and generic, with only the utility kind varying:

```text
Raportează index electricitate
```

`kind` comes from the meter config (`electricity`, `water`, `gas`) and is never
a house or meter name. `script.notify_index_submitter` fills it in;
`script.notify_admin` stays on Pushover and never routes detail through ntfy.

## When no reminder is sent

A meter is **reported** when either:

- `sensor.submission_<meter>` holds the period of the current reporting window;
  or
- `sensor.company_status_<meter>` holds that period with a positive state:
  `proposed`, `sending`, `forwarded`, `accepted`, `suppressed`, `blocked` or
  `error`.

`reopened` and `invalidated` do not count. The check is per meter: reporting
one meter never suppresses a reminder for another meter or utility. A `reported`
meter also suppresses the close alert.

The company status entity reads the single retained
`meters/casa/status/<meter>/current` topic, not the `status/<meter>/+` wildcard.
The wildcard let an old retained `proposed` period overwrite a newer `accepted`
one after a restart, which is how a reported meter kept producing reminders.
[`ha/meter_status_mirror.yaml`](../ha/meter_status_mirror.yaml) maintains the
current topic monotonically.

There is **one** scheduled reminder (10:00) and one close alert (10:05). Do not
add a second “missing submission” watchdog: it duplicates the daily reminder and
will double-notify the admin.

## 5. Test

Publish straight to ntfy from a machine with `.env.ntfy`:

```bash
node tools/ntfy-notify.js \
  --title "Raport consum test" \
  --message "Test de livrare." \
  --url https://example.invalid/ \
  --action-label "Deschide pagina de raportare"
```

Then trigger the HA path:

```yaml
action: script.ntfy_notify
data:
  title: Raport consum test
  message: Test de livrare.
  priority: default
  tags: bell
  url: https://example.invalid/
  action_label: Deschide pagina de raportare
```

A successful test appears in the ntfy app and in the HA log as a
`rest_command.ntfy_publish` call. The test message must not contain a real meter
index, contract number, address, or token.

## 6. Rotation and failure handling

- **Rotate the topic:** generate a new UUID, update `.env.ntfy` and the
  `ntfy_url` secret, reload REST commands, and resubscribe the phones.
- **ntfy unreachable:** `rest_command` logs the failed request; the reminder is
  not retried. The admin Pushover path is independent.
- **Reminder skipped:** nothing retries a missed daily reminder. The window
  logic in `automation.meters_daily_reminder` decides the next run.
- **Topic leaked:** rotate immediately. The topic grants ntfy access only; it
  does not grant MQTT or HA access.
