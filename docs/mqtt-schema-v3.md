# MQTT schema v3 — data only

Status: **proposed clean schema**. The browser page owns meter metadata and
readings. Home Assistant owns orchestration: notification routes, provider
entity mappings, SMTP recipients, contract data and automatic sensor sources.
None of those HA names or secrets belong in the retained MQTT config.

## Roles

| Role | Who | Responsibility |
|---|---|---|
| **Index submitter** | The person who reads the meters | Reads one or more meters and submits the new index. |
| **Company submitter** | The account owner / operator | Reviews submitted indices, edits configuration, and authorizes or performs the company submission. |

The role names are deliberately explicit. Existing `reporter`/`admin` token
names can remain as transport credentials, but user-facing labels and the
`submitted_by` payload use `index_submitter` and `company_submitter`.
Legacy `reporter`/`admin` values are accepted during migration.

## Config payload

```json
{
  "v": 1,
  "schema": 3,
  "installation": "casa",
  "updated_at": "2026-10-20T18:00:00Z",
  "timezone": "Europe/Bucharest",
  "locale": "ro",
  "admin_default_house": "house-a",
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

### Fields that stay in MQTT

- house and meter identity, display metadata, order and visibility;
- optional `admin_default_house` for the admin page's initial reporting/history
  filter (the admin's later selection is stored in the browser);
- `reading_mode` (`manual` or `external`) as a UI/behaviour hint;
- index unit and, optionally, the unit and conversion factor for the typical
  consumption profile (`consumption_unit`, `consumption_factor`);
- baseline, typical consumption and seasonal profile;
- reporting window;
- anomaly thresholds;
- photo enabled/size metadata.

`external` means the index is supplied outside the index-submitter form (for
example by an HA sensor or a smart meter). It does **not** contain an HA entity
id.

`typical_month`/`typical_by_month` are in `consumption_unit`. The expected
index is computed in the meter's index unit by dividing the profile by
`consumption_factor` (consumption units per index unit). Example: a gas meter
with `unit: "m³"`, `consumption_unit: "kWh"` and `consumption_factor: 10.45`
keeps its index in m³ while allowing the seasonal profile to be entered in kWh.

### Fields removed from MQTT

- `notifications` — routing is HA-only.
- `meters[].notify` — routing is HA-only.
- `meters[].reporting` — replaced by `reading_mode`; no HA entity type.
- `meters[].source.entity_id` — source entity is HA-only.
- `meters[].forwarding` — provider entities, SMTP service, contract holder,
  contract address, client code and centre are HA/private-only.
- Any SMTP service or provider entity name.

## Boundary: what remains on MQTT

MQTT carries the **data plane**: config metadata, submissions, last pointers,
photos and the new-index event. The company status and the non-retained
approve/suppress command remain a narrow **human decision transport** because
the admin page is the approval UI. They contain no HA entity names, SMTP
settings, routes or contract data. If the goal is a completely control-free
MQTT namespace, move approve/suppress to an HA dashboard/script next; the page
would become read-only for company actions.

## Submission payload

Keep the existing submission fields and use the new role values:

```json
{
  "v": 1,
  "id": "01J...",
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
  "client": { "tz": "Europe/Bucharest", "ua": "..." }
}
```

`submitted_by` is `index_submitter` or `company_submitter`. HA accepts legacy
`reporter`/`admin` during migration.

## Admin reset marker

The admin **Reset raportare** action removes the known submission/status/photo
topics and publishes a retained marker to `meters/<installation>/last/<meter>`:

```json
{
  "v": 1,
  "installation": "casa",
  "meter_id": "gas-a",
  "period": "reset",
  "index": null,
  "submitted_at": "2026-10-23T18:00:00Z",
  "submitted_by": "company_submitter",
  "reset": true,
  "cleared_at": "2026-10-23T18:00:00Z"
}
```

Consumers must treat the marker as "no current submission". It keeps the HA
submission sensor in a known state so reminders can resume; `company_preflight`
ignores it because `period` is not a real `YYYY-MM` and `index` is not numeric.
The next real submission replaces the marker.

## New-index event

A non-retained event tells HA that the index submitter has added a new index.
It is data, not routing: HA decides who to notify and through which channel.

Topic:

```text
meters/<installation>/event/index
```

Payload:

```json
{
  "v": 1,
  "id": "01J...",
  "meter_id": "electricity-a",
  "period": "2026-10",
  "index": 21870,
  "submitted_by": "index_submitter",
  "submitted_at": "2026-10-17T18:05:12Z"
}
```

- QoS 1, retained **false**.
- Published by the index submitter after a successful submission.
- Consumed by HA `new_index_notify`, which notifies the company submitter.
- No HA entity ids or routing configuration are in the event.

## HA-owned mapping

The public package includes only an example. Real values live in a private HA
file/helper, never in MQTT and never in Git.

```yaml
template:
  - sensor:
      - name: Meter operations
        unique_id: meter_operations
        state: "ok"
        attributes:
          routes:
            electricity-b:
              target: index_submitter
          company:
            electricity-b:
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

- `routes` replaces `meters[].notify`.
- `company` replaces `meters[].forwarding`.
- `sources` replaces `meters[].source.entity_id`.
- The company submitter configures this private sensor in HA.
- The index submitter and company submitter names are stable role labels; the
  tokens remain transport credentials.

## Notification link

Reminder notifications published to ntfy include a visible action labelled
**Open index reporting page**, pointing at the reporter page. Provider/new-index
notifications can carry a separate **Open administration** action pointing at
the admin page.

## Migration

1. Read the existing schema-2 config.
2. Map `reporting: smart|sensor` to `reading_mode: external`; otherwise
   `manual`.
3. Drop `notify`, `source`, `forwarding` and `notifications` from the MQTT
   payload.
4. Copy those values into the private `sensor.meter_operations` mapping.
5. Publish schema 3 from the admin page.
6. Keep the old config in the private backup until one full cycle succeeds.

The app normalizes legacy configs on load so an admin can migrate without
hand-writing JSON.
