# TODO — Report Consumption

Updated: 2026-10-20

Legend: **P0** = blocker, **P1** = needed before calling the system mature,
**P2** = code quality / polish.

## Repository cleanup status

- [ ] Purge unreachable commit objects from GitHub. The public branch was rewritten
      from a clean snapshot and the old refs are gone, but old commit SHAs can
      still return HTTP 200. Grant the GitHub token `delete_repo` and recreate the
      repository, or ask GitHub Support to purge the unreachable objects.
- [ ] Keep the private PII denylist at
      `../report-consumption-private/pii-denylist.txt`; never commit it.

- [x] Public tree sanitized: generic seed, generic meters/houses/entity
      placeholders, no real addresses/account numbers/names.
- [x] Old public repository renamed to a **private archive**; its Pages site is
      disabled/404.
- [x] New public repository created from clean orphan history
      (`f55681e` plus generic follow-up commits), generic author metadata.
- [x] GitHub Pages rebuilt from the clean repository; `/config/seed.json` now
      returns the generic demo seed only.
- [x] Verified a fresh clone of the public repository contains no sensitive
      files and no PII patterns.
- [ ] Delete the private archive repository after granting the GitHub token the
      `delete_repo` scope (or delete it from the GitHub UI). It still contains the
      old private history.
- [ ] Ask GitHub Support to purge cached views/old Pages artifacts if the
      pre-cleanup repository was indexed or cached externally.
- [ ] Treat GitHub Archive/forks/search-engine copies from the public period as
      potentially permanent; monitor or request removal where possible.
- [ ] Keep the real config locally in
      `../report-consumption-private/` (seed, tokens, bridge, HA package,
      internal notes); never commit it.

## Home Assistant live configuration (verified)

- [x] Reminder automation on.
- [x] Water sent watcher on.
- [x] Company preflight on.
- [x] Company submit on.
- [x] Close alert on.
- [x] Bridge heartbeat on.
- [x] Global `input_boolean.publicare_companie` is off (suppressed).
- [x] `sensor.meters_config` is live with the real private config.
- [x] The `Raport consum` dashboard view exists.
- [x] Admin notifications call `script.notify_admin` (Pushover to `kalioPhone`);
      mother/index-submitter reminders call `script.notify_index_submitter`
      (generic ntfy). ntfy is no longer used for admin messages.
- [x] Local ntfy topic generated with `uuid.uuid4()`, stored in the gitignored
      `.env.ntfy` (mode 600), and the HA -> MQTT -> Flespi -> listener path was
      tested.
- [ ] Run `tools/ntfy-listener.js` as a persistent service on an always-on host.
- [x] Real HA package and bridge config are kept in the private local directory.

## CATD water e-mail

- [x] SMTP recipient `<private CATD recipient>` added as a private HA notify
      entity; the existing SMTP service works (test message sent to the owner).
- [x] Generic `forwarding.mode: email` and HA email submit branch implemented.
- [x] CATD water meter added to the private/live config as **hidden**, mode
      `none`, with placeholders; it is not yet sending.
- [ ] Fill the private contract holder, contract address and client/subscriber code.
- [ ] Confirm the private operating centre and whether the contract is household
      (quarterly) or association/economy (monthly).
- [ ] Set the current water index/baseline, switch mode to `email`, and make the
      meter visible if the reporter should submit it.
- [x] SMTP test emails were sent only to `kapunifi@gmail.com`; no email was sent
      to the CATD address.
- [ ] Keep `water-c` in `forwarding.mode: none` until the real contract data
      is filled and the owner explicitly approves a CATD send.
- [ ] Run one real CATD email cycle only after that approval; keep the SMTP
      timestamp and status evidence.

## P0 — private deployment inputs

- [ ] Publish the real seed/config from the admin console; keep the real seed in
      the ignored `config/seed.local.json`, not in this repository.
- [ ] Set the real reporting window and baseline date for the reporter-visible
      meter(s).
- [ ] Set the real automatic source entity for any `reporting: sensor` meter.
- [ ] Confirm provider/company forwarding mappings and whether each meter uses
      `none`, `notify` or `approve`.
- [ ] Confirm the explicit Pushover target is `kalioPhone` for the admin, and the
      mother is subscribed to the local ntfy topic.
- [ ] Run one real cycle: reminder → reading → reminders stop → preflight →
      approve/suppress → provider result → HA visibility.

## P0 — final approval and owner review

- [ ] **Owner review: read every Mermaid user flow in `docs/user-flows.md` and fix
      any issue before enabling the company/CATD gate.** Approval is
      `APPROVE WITH CONDITIONS`; this review is one of the conditions.
- [ ] Keep `input_boolean.publicare_companie` off until the flow review and the
      live evidence conditions in `docs/user-flows.md` are closed.
- [ ] Verify the index submitter is subscribed to the **ntfy** topic and the
      company submitter receives **Pushover** on `kalioPhone`.
- [ ] Capture one generic ntfy reminder and one detailed Pushover admin alert;
      confirm no address or identifier is in the ntfy message/URL.

## P0 — privacy invariants

- [x] No physical/house address in MQTT config, seed, reporter UI or admin UI.
- [x] CATD contract address, provider entities and SMTP data live only in the
      private HA mapping, never in MQTT or the app.
- [x] ntfy stays generic; admin Pushover may carry operational detail but never
      a physical/contract address, token or installation id.
- [x] Notification URLs are bare: no query string and no fragment. The invite
      token is stored in localStorage and stripped from the URL.
- [ ] Re-mint the reporter token with `event/index` publish rights; until then
      the new-index event cannot reach HA.
- [ ] Replace the live schema-2 retained config with schema 3 after filling the
      private `sensor.meter_operations` mapping.

## P0 — deployment security

- [ ] Keep `.env.tokens`, `ha/flespi-bridge.conf`, `backups/`,
      `.playwright-mcp/`, `config/seed.local.json` and private planning outside
      git.
- [ ] Confirm no real addresses, account numbers, meter IDs, provider entity IDs
      or personal names are in the public tree.
- [ ] Add a PII scan to pre-commit/CI in addition to `tools/check-secrets.js`.
- [ ] Rotate any credential that was ever exposed; do not rely on a deleted
      commit as revocation.
- [ ] Review every commit touching `config/`, `ha/`, `docs/` or tests.

## P1 — reliability and operations

- [ ] Enable Mosquitto persistence and mount `/mosquitto/data`.
- [ ] Schedule `npm run healthcheck` and alert on non-zero exit.
- [ ] Create and record a Flespi Master token rotation calendar.
- [ ] Schedule `npm run backup`; keep at least next cycle + 5 days (13 months
      recommended).
- [ ] Decide whether offsite backup is required; currently local only.
- [ ] Verify the admin close-alert delivery in a real window.
- [ ] Confirm the provider `accepted` inference against a real provider
      confirmation.

## P1 — code/spec gaps

- [ ] Add a preflight anomaly/refusal check.
- [ ] Add a first reminder at window open, not only the daily 10:00 run.
- [ ] Add scheduled retention enforcement.
- [ ] Commit importable dashboard/helper/discovery artifacts.
- [ ] Decide whether `notifications.channels`, `forwarding.hold_minutes` and
      `source.entity_id` stay; source adapter is not built yet.
- [ ] Make house migration interactive rather than silently assigning a fallback.
- [ ] Reduce duplicated baseline/period helpers and duplicated HA window Jinja.
- [ ] Refine close-alert timing/dedupe if the fixed 10:05 run is insufficient.

## P2 — polish

- [ ] Add a changelog/release checklist.
- [ ] Document the public/private repository split and private-seed workflow.
- [ ] Re-run the two-axis code review after real-cycle changes.
