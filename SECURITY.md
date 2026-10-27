# Security policy

## Supported versions

Only the latest published minor version receives fixes.

## Reporting a vulnerability

Please report privately through GitHub's **Report a vulnerability** feature on
this repository (Security tab → Advisories), not in a public issue.

Include what you found, how to reproduce it, and the version. You will get an
acknowledgement on a best-effort basis; there is no service-level commitment.
Coordinated disclosure is appreciated. Credit is given in the advisory unless you
ask otherwise.

## Scope notes

- This package creates infrastructure in your AWS account. Review the synthesized
  template before deploying, as you would for any construct.
- The idempotency helper writes to a DynamoDB table you own. It stores only the
  Stripe `event.id` and a TTL; no event payload is persisted by this library.
- Stripe delivers events to the partner bus directly; this library never handles
  Stripe secrets or webhook signing keys.

## Data handling (read before deploying)

- **The bus archive and any queue hold full Stripe event payloads**, which
  include customer email addresses, names, and amounts. The archive defaults to
  90 days (`archiveRetention`; set `enableArchive: false` to skip it). Give
  dead-letter and unrouted queues a retention you are comfortable with and keep
  SQS server-side encryption on (it is on by default for new queues).
- **The idempotency table stores only `eventId` and a TTL.** No payload is
  persisted by this library.
- **IAM is least privilege by default.** `StripeProjectConsumer` and
  `StripeIngestion.grantIdempotency` grant exactly `dynamodb:PutItem`; the
  runtime helper never reads, updates or deletes.
- **A consumer cannot widen its own filter.** `extraEventPattern` rejects any
  attempt to set `source`, `detail-type` or `metadata.project`, so one project's
  stack cannot subscribe to another project's events by accident. Within one
  AWS account that boundary is a convenience, not a security control: anyone who
  can deploy to the account can read the bus.
- **SSM parameters are plain `String`.** They hold the bus ARN, bus name, partner
  source name and table name, none of which is a secret.
- **No webhook secrets exist.** Delivery is Stripe's native EventBridge
  destination, authenticated by the partner source association, so there is
  nothing to rotate.
