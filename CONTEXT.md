# Context — Report Consumption

The shared language of the meter-reporting domain. Glossary and relationships
only; no implementation details.

## Glossary

**Installation** — the reporting account that ties the reporter, administrator and
all houses together. One installation has one MQTT namespace and one
configuration; it can contain one or more houses.

**House** — a logical property group whose meters are reported (for example House A or
House B). No street address is stored in MQTT or the app. A house has a stable id, a display name and a reporter visibility flag. A Meter belongs to exactly one House.

**Index submitter** — the person who reads the meters and submits the indexes.
There is one index submitter per installation in this effort.

**Company submitter** — the person who reviews submissions, configures meters,
windows and thresholds, and authorizes company submission. There is one company
submitter per installation.

**Meter** — one reportable index. A physical meter with several registers (for
example day and night electricity) is represented as several meters sharing a
group, rather than as one meter with a nested form. Each meter has exactly one
unit, one precision and one baseline.

**Register** — a distinct counter on a physical meter. In this model, a register
is the thing a Meter represents; a multi-register meter becomes multiple Meters.

**Index** — the number physically shown on the meter at a point in time. It only
ever increases, except when the meter is replaced or reset.

**Reading** — an index value together with the moment it was taken. A reading is
not yet a report.

**Submission** — a reading reported for a Meter in a Period. A submission is the
unit of truth for "has this meter been reported?".

**Period** — the month a submission belongs to, written `YYYY-MM`. It is decided
by when the reporting window opens, not by when the submission arrives.

**Reporting window** — the interval in which the company accepts a self-read
index for a Period. A window has an opening and a closing moment and may cross a
month boundary. A meter may have no window configured, in which case it accepts a
submission at any time.

**Baseline** — the last known index used as the starting point for the next
expected range. It is either the seed value or the most recent submission.

**Expected consumption** — the typical monthly consumption prorated to the days
elapsed since the baseline. It is an estimate, never a promise.

**Expected range** — the index interval around the baseline plus expected
consumption within which a reading is considered normal.

**Warning** — a reading outside the expected range but within the refusal limits.
It can be submitted after the reporter acknowledges it.

**Refusal** — a reading so far outside the expected range that the page will not
publish it without an explicit override.

**Late submission** — a submission made after the reporting window closed. It is
accepted and flagged, never silently discarded.

**Correction** — a submission that replaces an earlier submission for the same
Meter and Period. The latest submission for a Period wins.

**Photo** — an optional image of the meter face, attached to a submission. It is
evidence for the administrator, not part of the index value.

**Reminder** — a notification sent while a reporting window is open and the Meter
has no submission for that Period. It stops as soon as a submission exists.

## Relationships

- An Installation has one Index submitter, one Company submitter and one or more Houses.
- A House has one or more Meters.
- A Meter has one Baseline and a sequence of Submissions.
- A Submission belongs to exactly one Meter and one Period; it records the House
  that the Meter belonged to at submission time.
- A Period is defined by the Meter's reporting window.
- A Correction replaces the Submission for the same Meter and Period.
- A Photo belongs to at most one Submission.

## Domain rules

- At most one Submission exists per Meter and Period; a later one is a Correction.
- The latest accepted Submission is the Baseline for the next Period.
- A refused reading never becomes a Baseline.
- A reading below the Baseline is a meter reset, not a normal consumption; it
  requires explicit confirmation.
- A late Submission is accepted and marked late; it still stops the reminders.
- An expected range is unavailable until the Meter has both a Baseline and a
  typical consumption.
- The expected range never blocks a first reading.
- Notifications are sent only for a Meter that has no Submission in the current
  Period.
