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
