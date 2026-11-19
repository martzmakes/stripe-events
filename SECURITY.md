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
- The idempotency helper writes the configured event key and a TTL to a DynamoDB
  table you own.
- Stripe delivers events to the partner bus directly; this library never handles
  Stripe secrets or webhook signing keys.

## Data handling (read before deploying)

- **The bus archive and any queue hold full Stripe event payloads**, which
  include customer email addresses, names, and amounts. The archive defaults to
  90 days (`archiveRetention`; set `enableArchive: false` to skip it). Give
  dead-letter and unrouted queues a retention you are comfortable with and keep
  SQS server-side encryption on (it is on by default for new queues).
- **The idempotency table stores only `eventId` and a TTL.** Use a Stripe event
  ID or a non-sensitive consumer-prefixed event ID as the key.
- **IAM is least privilege by default.** `StripeProjectConsumer` and
  `StripeIngestion.grantIdempotency` grant exactly `dynamodb:PutItem`; the
  runtime helper never reads, updates or deletes.
- **Project filters help prevent accidental cross-project delivery.**
  `extraEventPattern` preserves the generated source, event type, and project
  filters. Principals with permission to create rules or inspect the shared bus
  can access other projects' events. Use IAM and account boundaries for isolation.
- **SSM parameters are plain `String`.** They hold the bus ARN, bus name, partner
  source name and table name, none of which is a secret.
- **No webhook secrets exist.** Delivery is Stripe's native EventBridge
  destination, authenticated by the partner source association, so there is
  nothing to rotate.
