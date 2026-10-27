# @martzmakes/stripe-events

AWS CDK (v2) constructs that fan **one Stripe account's** events out to **many
independent projects** through Amazon EventBridge, routed by a `metadata.project`
tag, plus a small Lambda-side idempotency helper.

**Status:** 0.1.0, maintenance mode. It runs in production for the author's own
projects. There is no roadmap and no support commitment; see [SUPPORT.md](./SUPPORT.md).

One Stripe account maps to one legal entity, not one product. So several products
can live under the same Stripe account, separated by Products/Prices and a
`metadata.project` key stamped on every object they create. Stripe events are
**account-scoped** (a `checkout.session.completed` fires for any checkout anywhere
in the account), so routing happens on the AWS side, keyed on `metadata.project`.

## Architecture

```
                 ┌──────────────────────────────────────────────┐
   Stripe        │                  Your AWS account            │
 (one account)   │                                              │
      │          │   partner event bus (= partner source name)  │
      │  native  │            │                                 │
      └─────────▶│   ┌────────┴─────────┐      ┌──────────────┐ │
   EventBridge   │   │  StripeEventRule │      │ bus archive  │ │
  event dest.    │   │  metadata.project│      │  (replay/DR) │ │
                 │   │   == "project-a" │      └──────────────┘ │
                 │   └────────┬─────────┘                       │
                 │            ▼                                 │
                 │     project-a handler ──▶ idempotency table  │
                 │     (dedupe on event.id)   (DynamoDB + TTL)  │
                 └──────────────────────────────────────────────┘
```

- **Ingestion** uses Stripe's native [Amazon EventBridge event destination](https://docs.stripe.com/event-destinations).
  Stripe delivers straight onto a partner event bus: no public webhook endpoint,
  no signature verification, no ingest Lambda.
- In the EventBridge envelope: `source` is the partner source name
  (`aws.partner/stripe.com/ed_xxx`), `detail-type` is the Stripe event type, and
  `detail` is the full Stripe event object, so the routing tag lives at
  `detail.data.object.metadata.project`.
- EventBridge delivery is **at-least-once**, so consumers dedupe on Stripe's
  `event.id` with the runtime helper.
- Replay and disaster recovery use the EventBridge **native bus archive**.

## Install

```sh
npm i @martzmakes/stripe-events
# peers:
npm i aws-cdk-lib constructs
```

Two subpath exports keep dependency graphs separate:

| Import                              | For             | Depends on                          |
| ----------------------------------- | --------------- | ----------------------------------- |
| `@martzmakes/stripe-events`         | CDK constructs  | `aws-cdk-lib`, `constructs` (peers) |
| `@martzmakes/stripe-events/runtime` | Lambda handlers | `@aws-sdk/client-dynamodb`          |

Importing the constructs never drags the AWS SDK into your CDK synth; importing
the runtime helper never drags in `aws-cdk-lib`.

## Stripe-side setup (one time, manual, per environment)

This package does **not** create the partner event source. Do this once for each
environment (test and live):

1. In the Stripe Dashboard, go to **Developers → Event destinations → Add
   destination** (or **Workbench → Event destinations**).
2. Choose **Amazon EventBridge** as the destination.
3. Provide your **AWS account ID** and **region** (the region you deploy this
   stack to).
4. Select the events to send. You can send all, or a curated list; routing and
   filtering still happen on the AWS side per project.
5. Stripe mints a **partner event source** named like
   `aws.partner/stripe.com/ed_xxxxxxxxxxxx`. Copy it.
6. It shows as **Pending** in the EventBridge console until your
   `StripeIngestion` bus associates with it on first `cdk deploy`.

> Test mode and live mode each produce their **own** partner source. Deploy a
> `StripeIngestion` per environment with the matching `partnerSourceName`.

## Quickstart: root stack

Deploy once per account and environment:

```ts
import { StripeIngestion } from "@martzmakes/stripe-events";

new StripeIngestion(this, "StripeLive", {
  partnerSourceName: "aws.partner/stripe.com/ed_xxxxxxxxxxxx",
  envName: "live",
  // defaults: archive on (90d), idempotency table on (RETAIN), SSM params on
});
```

This creates: the partner-bound event bus, a bus archive, a PAY_PER_REQUEST
DynamoDB idempotency table (`eventId` PK + `ttl` TTL), and SSM parameters under
`/stripe/live/*` for discovery (`bus-name`, `bus-arn`, `partner-source-name`,
`idempotency-table-name`).

## Quickstart: consumer

A consuming project subscribes to **only its events** and never imports the root
stack. It discovers everything from SSM:

```ts
import { StripeEventRule, StripeEventType } from "@martzmakes/stripe-events";

StripeEventRule.fromSsm(this, "Subscription", {
  envName: "live",
  project: "project-a", // your metadata.project tag
  eventTypes: [
    StripeEventType.CheckoutSessionCompleted,
    StripeEventType.CustomerSubscriptionDeleted,
  ],
  handler: myLambda, // wrapped in a LambdaFunction target for you
});
```

See [`examples/`](./examples) for a complete root stack and a consumer stack
that also imports and grants the idempotency table.

## Handler idempotency

EventBridge delivers at-least-once, so dedupe on Stripe's `event.id`:

```ts
import { StripeIdempotencyStore } from "@martzmakes/stripe-events/runtime";

const store = new StripeIdempotencyStore({
  tableName: process.env.IDEMPOTENCY_TABLE!,
});

export const handler = async (event: { detail: { id: string } }) => {
  await store.process(event.detail.id, async () => {
    // runs at most once per Stripe event.id
  });
};
```

### Tag every object you create

Routing depends entirely on `metadata.project`. Stamp it on every Stripe object
your app creates (Checkout Session, Customer, Subscription, PaymentIntent):

```ts
import { withProject } from "@martzmakes/stripe-events/runtime";

await stripe.checkout.sessions.create(
  withProject({ mode: "payment", line_items: [...] }, "project-a"),
);
```

An object created without `metadata.project` will not match any `StripeEventRule`.

## Operating notes

- **Metrics on a partner bus publish under two dimensions.** When you query
  `AWS/Events` metrics (`MatchedEvents`, `Invocations`) for a rule on a partner
  bus, pass **both** `RuleName` and `EventBusName`. A query with `RuleName` alone
  returns no data points and looks like zero traffic.
- **Mis-tagged events are invisible to every project rule.** An object created
  without `metadata.project` only matches a catch-all rule. Add one (for example,
  an archive rule or a dead-letter target) so you can see them.
- **The archive has a retention window.** With the 90-day default, old events age
  out of the archive even though they were delivered.

## Non-goals

- Does **not** manage Stripe Products/Prices, checkout creation, or any payment
  logic.
- Does **not** create the Stripe partner event source (manual, documented above).
- **No** webhook-signature-verifying router mode. Everything is native
  Stripe → EventBridge.
- Not a Marketplace/Connect tool.

## Notes

- **TypeScript-only** (built with `tsup`), not jsii. The runtime idempotency
  helper needs to be a first-class library import, which mixes badly with jsii.
  Multi-language support would mean splitting into a jsii construct package plus
  a separate runtime package, which is out of scope.
- **Partner bus naming:** AWS requires a partner event bus's name to exactly
  equal its partner source name, so `StripeIngestion` always names the bus after
  `partnerSourceName`. The `eventBusName` prop is reserved and ignored (it emits a
  synth-time warning if it disagrees).

## Development

```sh
npm ci
npm run check   # lint, format, typecheck, test, build, repository guard
```

## Contributing, security, support

See [CONTRIBUTING.md](./CONTRIBUTING.md) (DCO sign-off, AI-assisted contribution
policy), [SECURITY.md](./SECURITY.md) and [SUPPORT.md](./SUPPORT.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Stripe is a trademark of Stripe, Inc. AWS and Amazon EventBridge are trademarks of
Amazon.com, Inc. or its affiliates. This project is not affiliated with either.
