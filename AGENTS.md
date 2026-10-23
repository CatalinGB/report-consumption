# Project instructions

These rules are non-negotiable for this repository. They apply to code, docs,
tests, HA packages, generated data and any future agent working here.

## Roles and vocabulary

- **Index submitter** — reads meters and submits indices. Transport credential:
  `reporter`.
- **Company submitter** — reviews, configures and authorizes company submission.
  Transport credential: `admin`.
- Use the role names in user-facing copy and `submitted_by`; legacy
  `reporter`/`admin` values are migration-only.

## Privacy invariants

1. **No physical/house address in MQTT or the app.**
   - Do not add `houses[].address` or any equivalent property to the config,
     seed, admin UI, reporter UI, tests or docs examples.
   - The only address that may exist is the private CATD contract address in the
     HA-only `sensor.meter_operations` mapping, because the provider requires it
     for an email. It must never be published to MQTT, displayed by the app, or
     sent to ntfy/Pushover.
2. **No PII in ntfy; Pushover is the admin channel.**
   - The index submitter (mother) receives **ntfy** notifications. They must be
     generic: no house/meter name, index, period, address, contract/client code,
     token, installation id, or other identifier.
   - The company submitter (admin) receives **Pushover** notifications on
     `kalioPhone`. Operational detail (meter, index, period, status) is allowed
     there. A physical/contract address is never allowed in any notification.
   - Admin detail must go through `ha/notify_admin.yaml`; mother reminders go
     through `ha/notify_index_submitter.yaml`. Do not bypass these wrappers with
     a direct `ntfy_notify`/Pushover call containing detail.
3. **Notification URLs are bare.**
   - No query string, no fragment, no token, no installation id, no index, no
     meter/period/house identifier.
   - Enforced in `ha/notify_admin.yaml`, `ha/ntfy_notify.yaml` and
     `tools/ntfy.js`.
   - The invite/access link may carry the token only in the URL fragment. The
     page must store it in `localStorage` and strip the fragment before any
     network activity. Never put an invite token in a notification.
4. **MQTT is the data plane.**
   - It carries config metadata, indices, last pointers, photos and the
     non-retained new-index event.
   - It must not carry HA entity ids, notify service names, SMTP settings,
     provider mappings, routes, contract data or addresses.
   - HA-owned orchestration lives in the private `sensor.meter_operations`
     mapping, never in retained MQTT.
5. **No secrets or real deployment data in Git.**
   - Keep `.env*`, tokens, bridge configs, private mappings, backups and real
     seeds out of the tree or in ignored paths.
   - The private mapping is ignored via `ha/*.private.yaml`; the public example
     contains placeholders only.

## Notification design

- Mother/index-submitter ntfy: **generic** “A reporting window is open. Open
  the index reporting page.”
- Admin/company-submitter Pushover: detailed operational update on `kalioPhone`;
  never include a physical/contract address.
- Link actions:
  - index-submitter reminders → **Open index reporting page**
  - admin reminders / new index / company updates → **Open administration**
- The index URL in a notification is the deployed `index.html` or `admin.html`
  with no query/fragment. The identifier is obtained once from the invite link
  and stored in `localStorage`.

## No PII in the public repository

The GitHub repository is public and its history is public. The tree, commit
messages, branches, tags, issues, PRs, screenshots and generated assets must not
contain deployment PII.

Forbidden in the public repository:

- physical addresses, locality or neighbourhood names;
- live house or meter display names, IDs or slugs;
- provider/contract client codes, account numbers, recipient emails or phone
  numbers;
- tokens, private entity ids, real seeds, private HA mappings or backups.

Use generic placeholders such as `house-a`, `house-b`, `meter-a`, `Provider A`,
`example.invalid` and `<private>`. Even a locality or house slug is private.
Real values belong only in `../report-consumption-private/`, private MQTT/HA
state, or the private archive.

Before committing, run the secret guard with the private denylist in place:

```bash
node tools/check-secrets.js --tracked
node tools/check-secrets.js --staged
node tools/check-secrets.js --history
```

The guard reads `../report-consumption-private/pii-denylist.txt` when present.
Never commit that denylist. If a value reaches git history, do not rely on a
later deletion: rewrite the public branch from a clean snapshot, force-push, and
verify old commit URLs are no longer reachable.

## Deployment compatibility

The reporter page is already deployed on the index submitter's phone. Treat every
change as a live migration, not a greenfield rewrite.

- Keep existing invite links, `localStorage` keys, installation ids and token
  roles working. Do not require mama to re-invite or clear browser storage for a
  normal update.
- Keep the MQTT contract additive. New config fields must be optional with safe
  defaults; do not remove or rename a field still present in the live retained
  config without a migration and a read-back check.
- Accept legacy roles and fields during migration (`reporter`/`admin`,
  `reporting`, `notify`) until the live config and HA package no longer use them.
- Test the reporter page against the real retained config shape before
  deployment. Backwards compatibility is a release gate, not a follow-up.
- An admin reset must not erase an `accepted`, `forwarded`, `sending` or
  uncertain company status; verify the provider portal before any reset that
  could enable a duplicate submission.

## Safety rules

- The global `input_boolean.publicare_companie` gate defaults off and must be
  required for a company send.
- Approval must verify the retained status is still `proposed`, with matching
  period and index, a numeric index and a fresh command.
- Never send a refused index. Never send CATD email without a configured window
  and explicit approval.
- A retry must be idempotent; do not turn an uncertain send into a blind resend.
- Backup/rotation/secret-guard changes must fail closed and be tested.

## Required checks

Before committing:

```bash
npm test
node tools/check-secrets.js --tracked
node tools/check-secrets.js --staged
node tools/check-secrets.js --history
```

For notification changes, also inspect a captured envelope and confirm:

- no house/meter/index/period/address/token/installation text;
- the URL has no `?` or `#`;
- the action label is generic;
- details are visible only after opening the app.
