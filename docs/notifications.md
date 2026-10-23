# Notifications — ntfy.sh

Report Consumption uses MQTT as the transport for its operational
notifications. A small local listener subscribes to one status topic and
forwards the envelope to an [ntfy.sh](https://ntfy.sh) topic. The ntfy topic is a
secret: it is generated locally, stored in `.env.ntfy` (gitignored, mode 600),
and never committed or placed in Home Assistant.

## Why a listener, not an HA YAML notify platform

This Home Assistant has no configured ntfy notify platform. The MQTT listener
keeps the topic off the HA configuration and works with the existing Flespi
bridge:

```text
HA script.ntfy_notify
  -> meters/<installation>/status/ntfy (local Mosquitto)
  -> Flespi bridge (status/# out)
  -> Flespi
  -> tools/ntfy-listener.js
  -> https://ntfy.sh/<local-topic>
```

The listener needs the home MQTT token and the local ntfy topic. Both are local
files; neither is part of the public repository.

## Privacy rule

Never send PII to ntfy: no house or meter name, index, period, address,
contract/client code, token or installation id. The index-submitter message is
generic; the admin receives operational detail on Pushover. Links must be bare
page URLs with no query or fragment. Details are visible only after opening the
app.

## 1. Create the local topic

```bash
python3 - <<'PY'
import uuid
print("https://ntfy.sh/" + str(uuid.uuid4()))
PY
```

`uuid.uuid4()` reads from the operating system CSPRNG. Save the UUID only in
`.env.ntfy`:

```dotenv
NTFY_TOPIC=<uuid>
NTFY_URL=https://ntfy.sh/<uuid>
```

The repository already ignores `.env.ntfy`. Do not put the UUID in a dashboard,
a notification message, a Git commit, or an issue.

If the topic is exposed, generate a new UUID and update `.env.ntfy`; the old
topic can no longer receive the listener's messages.

## 2. Subscribe on the phone

Install the ntfy Android/iOS app and subscribe to the topic (or open
`https://ntfy.sh/<topic>` once). Use a separate topic per installation if you
run more than one.

The topic is a bearer capability: anyone who knows it can publish or read.
Treat it like a password.

## 3. Run the listener

The listener is an ordinary Node process; it needs the same `mqtt` dependency as
the bridge healthcheck.

```bash
cd /path/to/report-consumption
node tools/ntfy-listener.js
```

It reads:

- `.env.tokens` → `REPORT_CONSUMPTION_HOME_TOKEN` (Flespi home token);
- `.env.ntfy` → `NTFY_TOPIC` and `NTFY_URL`.

The Flespi home token is backend-only. Do not put it in the browser page.

For a persistent service, run it on the same host as the Mosquitto bridge (or
any always-on host with MQTT access) under systemd or as a Docker service. A
minimal systemd unit:

```ini
[Unit]
Description=Report Consumption ntfy listener
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/report-consumption
ExecStart=/usr/bin/node tools/ntfy-listener.js
Restart=always
RestartSec=10
User=kalio

[Install]
WantedBy=multi-user.target
```

Use `Environment=RC_INSTALLATION=casa` only if the installation id is not
`casa`. The listener logs titles and the non-secret MQTT status topic; it never prints the ntfy topic or token.

## 4. Home Assistant scripts

Import [`ha/ntfy_notify.yaml`](../ha/ntfy_notify.yaml) as a script named
`ntfy_notify`, then import [`ha/notify_index_submitter.yaml`](../ha/notify_index_submitter.yaml)
as `notify_index_submitter`. The admin uses
[`ha/notify_admin.yaml`](../ha/notify_admin.yaml) for Pushover to `kalioPhone`;
that path is separate and does not call ntfy.

`script.ntfy_notify` publishes:

```json
{
  "v": 1,
  "title": "Report consumption",
  "message": "A meter is ready",
  "priority": "high",
  "tags": "bell",
  "url": "https://example.invalid/",
  "action_label": "Open index reporting page",
  "at": "2026-10-20T18:00:00+03:00"
}
```

to `meters/casa/status/ntfy` with QoS 1 and `retain: false`. The listener maps
`action_label` to a visible ntfy action button. `script.notify_index_submitter`
calls it with generic text; the admin uses `script.notify_admin` on Pushover and
never routes detail through ntfy.

Index-submitter reminders call `script.notify_index_submitter`. Admin alerts
call `script.notify_admin` with the normal Pushover fields. Never route admin
detail through ntfy.

## 5. Test

Send one message without waiting for a meter event:

```bash
node tools/ntfy-notify.js \
  --title "Report consumption test" \
  --message "The local ntfy listener is working." \
  --priority default
```

Then trigger the HA path:

```yaml
action: script.ntfy_notify
data:
  title: Report consumption test
  message: The MQTT to ntfy path is working.
  priority: default
  tags: bell
```

You should see the message in the ntfy app and a line in the listener log:

```text
ntfy listener: sent Report consumption test
```

The test message must not contain a real meter index, contract number, address,
or token.

## 6. Rotation and failure handling

- **Rotate the ntfy topic:** generate a new UUID, update `.env.ntfy`, restart the
  listener, and subscribe the phone to the new topic.
- **Listener down:** the index submitter misses the ntfy reminder; the MQTT
  notification envelope is non-retained, so it is not replayed later. The admin
  Pushover path is independent.
- **MQTT down:** the listener reconnects every 5 seconds; HA's `continue_on_error`
  keeps the admin Pushover path independent.
- **Topic leaked:** rotate immediately. A UUID alone does not grant MQTT access;
  the Flespi token is a separate secret.
