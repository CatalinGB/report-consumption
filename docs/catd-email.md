# CATD water index by e-mail

CATD accepts self-read water indexes by e-mail inside a monthly window. The
window, operating centre and recipient depend on the contract and the property's
address. Use the values printed on the contract and the official CATD contact
page; this repository keeps only placeholders.

```text
centre:  <operating centre from the contract>
window:  <open day and time> – <close day and time>   (example below: 1–12)
e-mail:  notify.<catd_recipient>   (a private HA notify entity)
```

The message must contain:

- contract holder name;
- complete address;
- client/subscriber code;
- old and new water index (m³).

The public CATD page also lists phone and the customer portal. This project uses
the e-mail channel only; it does not automate the portal or scrape account data.

## Configuration

A CATD meter is a normal schema-3 water meter. MQTT carries only meter data and
`reading_mode`; it must **not** carry `notify`, `reporting`, `source` or
`forwarding`:

```json
{
  "id": "water-c",
  "house_id": "house-b",
  "name": "Water CATD",
  "provider": "CATD",
  "unit": "m³",
  "precision": 3,
  "visible": false,
  "reading_mode": "manual",
  "window": {
    "type": "monthly",
    "open_day": 1,
    "open_time": "09:00",
    "close_day": 12,
    "close_time": "23:59"
  }
}
```

The window above is an **example**. Confirm the real open/close days and times
from the contract; CATD can change them. A meter with no window is refused by
the e-mail path by design.

The submission and company-status discovery files are:

- `ha/discovery/submission_water_c.json`
- `ha/discovery/company_status_water_c.json`

## Private mapping

Contract data and the SMTP recipient are private. Put them in
`sensor.meter_operations` in HA, never in MQTT, Git, an issue or a dashboard:

```yaml
template:
  - sensor:
      - name: Meter operations
        unique_id: meter_operations_private
        state: "ok"
        attributes:
          routes:
            water-c:
              target: company_submitter
          company:
            water-c:
              mode: email
              smtp_service: notify.<catd_recipient>
              contract_holder: "<private contract holder>"
              contract_address: "<private contract address>"
              cod_client: "<private client code>"
              center: "<private operating centre>"
```

`notify.<catd_recipient>` is a Home Assistant notify entity whose recipient is
configured in the UI. The actual address must not be hardcoded in public
examples. See `ha/meter_operations.example.yaml` for the full example.

## Flow

```text
reading -> proposed status -> explicit admin Approve
        -> input_boolean.publicare_companie on
        -> retained status still proposed, same period and index
        -> command at <= 10 minutes old
        -> CATD window configured and now inside open..close for that period
        -> range_state check (if present)
        -> retained `sending`
        -> notify.send_message through the private SMTP entity
        -> retained `forwarded`
        -> admin notification (no delivery confirmation)
```

`ha/company_submit.yaml` writes `sending` before SMTP and confirms
`forwarded` through `script.company_send_email`. If the SMTP call fails or the
confirmation does not arrive within 30 seconds, HA writes a retained `error`
with `uncertain: true` and notifies the company submitter.

`Suppress` never sends. It writes a durable retained `suppressed` status with
`cancelled_at`; a later approve for the same period is refused. Suppress cannot
overwrite `accepted`/`forwarded`, so it cannot hide a send that already happened.
Commands are serialized with `mode: queued`; a suppress cannot interrupt an SMTP
send already in progress.

## Guard rails

- never send with no window configured;
- never send outside the CATD window: the check uses the full open/close date,
  time and period, not only the day of month;
- never send a proposal with `range_state: refuse`;
- `range_state: ok`, `unknown` or `warn` is allowed only through the explicit
  approve command; an unknown value is rejected;
- never send twice for the same period: `accepted`/`forwarded`/`suppressed`/
  `sending` proposals are protected, and one send per meter + period is enforced
  by the retained status;
- require the global `input_boolean.publicare_companie` gate;
- a correction needs a new approval and a new status/proposal cycle;
- if the status is `error` with `uncertain: true`, verify the CATD mailbox before
  any retry. Do not auto-repropose an uncertain attempt.

The app cannot see SMTP delivery or bounce; `forwarded` means the SMTP service
accepted the message, not that CATD processed the index. The administrator must
watch for the CATD response or a later estimated bill.

The rendered message body contains private contract data and is deliberately
not written to MQTT. The audit trail is the HA automation trace and the SMTP
provider's sent folder; the retained status stores only index, period and
timestamps.

## Testing policy

Test the SMTP path only against the owner's mailbox until the real contract data
is filled and the owner explicitly approves a CATD send. Do not use placeholder
names, addresses or codes in a message to the CATD address. First test with the
global gate off and confirm that the automation stops at `blocked`. Then use a
test notify entity that points at the owner's mailbox, not at CATD.

Useful checks:

- remove the window from a test meter: the status must become `blocked` with
  `no email reporting window configured`;
- set a window that closed yesterday: the status must become `blocked` with
  `outside the email reporting window`;
- add `range_state: refuse` to a test proposal: the status must stay `blocked`;
- press Suppress after a proposal: the status must become `suppressed`, and a
  later approve must be refused;
- simulate an SMTP failure: the status must become `error` with
  `uncertain: true`, and the admin must be notified.

## Household cadence

CATD reads household meters once every three months; self-reads are still
allowed more often. If the contract is household, decide whether to remind
monthly or only in the three-month cadence and set the meter window accordingly.
Do not assume the example 1–12 window matches the contract.

## What is still required from the owner

- the contract holder name;
- the complete address;
- the CATD client/subscriber code;
- the current meter index/baseline;
- the operating centre printed on the contract;
- the real CATD self-read window (open/close day and time);
- whether it is a household (quarterly) or association/economy contract;
- the exact SMTP notify entity and its recipient, configured in the HA UI.
