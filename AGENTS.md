# Agent and contributor notes

Read CONTRIBUTING.md first. This file is the short operational contract for
humans and coding agents working in this repository.

## Layout

- `src/` constructs: `StripeIngestion` (root), `StripeEventRule` (one project's
  rule), `StripeProjectConsumer` (rule + idempotency grant + DLQ for a project),
  `StripeUnroutedEventsRule` (catch-all for untagged events), `StripeEventType`,
  SSM key helpers. Peers: `aws-cdk-lib`, `constructs`.
- `src/runtime/` Lambda helpers: `StripeIdempotencyStore`, `withProject`.
  Depends only on `@aws-sdk/client-dynamodb`. Never import `aws-cdk-lib` here.
- `test/` vitest with CDK `assertions` and `aws-sdk-client-mock`.
- `examples/` illustrative root and consumer stacks, typechecked via tsconfig
  `paths`, not deployed in CI.
- `scripts/check-repository.mjs` repository guard; runs in `npm run check` and CI.

## Gotchas

- A partner event bus's name must equal its partner source name. Pass only
  `eventSourceName` to `EventBus`; passing both throws.
- Rules on a partner bus must reference the bus by ARN (names starting with
  `aws.` are rejected). `StripeEventRule` already does this.
- Routing key: `detail.data.object.metadata.project`. Dedupe key: `detail.id`.
- There is no webhook-signature code anywhere, by design. Do not add it.

## Verify before claiming done

```sh
npm run check
npm publish --dry-run   # confirm the tarball holds only dist, README, LICENSE, NOTICE
```

## Never commit

Account ids, partner source names from real deployments, hostnames, credentials,
`.env` files, or fixtures with real people's data. Synthetic values only.
