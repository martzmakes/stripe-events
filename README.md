# @martzmakes/stripe-events

AWS CDK v2 constructs for running multiple projects on one Stripe account. Stripe delivers events directly to an Amazon EventBridge partner bus. Each project deploys a rule that matches its own `metadata.project` and the event types it handles.

```text
Stripe account → EventBridge partner bus ─┬─ project-a rule → project-a Lambda
                                         ├─ project-b rule → project-b Lambda
                                         ├─ missing project tag → SQS (optional)
                                         └─ EventBridge archive (optional)

Root stack → SSM parameters → consumer stacks
Consumer Lambda → DynamoDB conditional write (optional duplicate suppression)
```

The projects can live in separate repositories and deploy independently. The SSM-based examples put the root and consumer stacks in the same AWS account and Region. A project tag is a routing convention within that shared infrastructure. Use AWS account and IAM boundaries when workloads require isolation.

## Install

```sh
npm install @martzmakes/stripe-events aws-cdk-lib constructs
```

Use Node.js 22 or newer. The constructs use `aws-cdk-lib` 2.247.0 or newer within CDK v2 and `constructs` 10.5 or newer within v10. Both entry points ship TypeScript declarations for ES modules and CommonJS.

| Import                              | Use it for                                                       |
| ----------------------------------- | ---------------------------------------------------------------- |
| `@martzmakes/stripe-events`         | CDK constructs, Stripe event names, and SSM parameter helpers    |
| `@martzmakes/stripe-events/runtime` | `withProject` and `StripeIdempotencyStore` in app or Lambda code |

The runtime entry point imports the DynamoDB SDK. It can be bundled into a Lambda without pulling in CDK. When using `NodejsFunction`, set `bundling: { bundleAwsSDK: true }` to ship the SDK version from your lockfile with your function.

## 1. Create a Stripe event destination

1. In Stripe Workbench, open **Webhooks** and create an event destination for **Your account**. Start in a sandbox.
2. Select the snapshot events your apps handle, such as `checkout.session.completed` and `customer.subscription.deleted`. The routing rule needs the resource snapshot at `detail.data.object`.
3. Choose **Amazon EventBridge** and supply your target AWS account and Region.
4. In that Region, find the pending Stripe partner event source and copy its full name, such as `aws.partner/stripe.com/ed_example`. Deploy the root stack in the next step to associate it with the bus.

Create a separate destination and root stack for live traffic. Use different environment names, such as `test` and `live`, to keep their discovery paths and idempotency tables separate. [Stripe EventBridge setup](https://docs.stripe.com/event-destinations/eventbridge)

## 2. Deploy the shared root stack

Add `StripeIngestion` to a CDK stack in the destination's account and Region.

```ts
import { StripeIngestion } from "@martzmakes/stripe-events";

const ingestion = new StripeIngestion(stack, "Stripe", {
  partnerSourceName: "aws.partner/stripe.com/ed_example",
  envName: "test",
});
```

The construct creates a partner-bound bus whose name equals `partnerSourceName`. It also defaults to a 90-day EventBridge archive, a retained on-demand DynamoDB table, and these SSM parameters under `/stripe/test/`.

| Parameter                | Value                             |
| ------------------------ | --------------------------------- |
| `bus-arn`                | Partner bus ARN used by the rules |
| `bus-name`               | Partner bus name                  |
| `partner-source-name`    | Value matched against `source`    |
| `idempotency-table-name` | DynamoDB table name, when enabled |

Set `enableArchive: false` to skip the archive or `archiveRetention` to adjust retention. Set `idempotency: { enabled: false }` to skip the table or `ssm: { enabled: false }` to skip discovery. If you set a custom `ssm.prefix`, use the same `ssmPrefix` in the consumer. Deploy the root before deploying consumers using SSM.

## 3. Add a consumer in each project

Use `StripeProjectConsumer` with a Lambda created by your CDK app. The construct resolves the shared settings through SSM at deployment and creates a rule for the project and event types you specify.

```ts
import { Duration } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import {
  StripeEventType,
  StripeProjectConsumer,
} from "@martzmakes/stripe-events";

new StripeProjectConsumer(stack, "BillingEvents", {
  envName: "test",
  project: "project-a",
  eventTypes: [
    StripeEventType.CheckoutSessionCompleted,
    StripeEventType.CustomerSubscriptionDeleted,
  ],
  handler: billingFunction,
  deadLetterQueue: new Queue(stack, "StripeDeliveryDlq", {
    retentionPeriod: Duration.days(14),
  }),
  retryAttempts: 5,
});
```

By default, the consumer grants `dynamodb:PutItem` on the shared table and sets `IDEMPOTENCY_TABLE` on a CDK-managed Lambda. For an imported Lambda, configure its environment and ensure its execution role has the grant. Use `grantIdempotency: false` if your handler has its own deduplication or the root has disabled the table. Event type strings work as well as the `StripeEventType` constants.

Use `StripeEventRule.fromSsm(...)` for a plain rule with a custom target, or `new StripeEventRule(...)` with an existing bus and its `partnerSourceName`. You can use `extraEventPattern` to add a constraint such as `detail.livemode`, while `eventTypes` and `project` own the routing fields.

## 4. Tag the objects that emit your events

The rule matches three fields in the EventBridge envelope. It uses `source` for the Stripe partner source, `detail-type` for the Stripe event type, and `detail.data.object.metadata.project` for the project. The comparison is case-sensitive. Use a stable server-side slug of up to 128 characters. Start with a letter or digit and use only letters, digits, dots, underscores, or hyphens.

For subscription Checkout, stamp both the Session and the Subscription so both event types in the example can match.

```ts
import { withProject } from "@martzmakes/stripe-events/runtime";

const project = "project-a";

await stripe.checkout.sessions.create(
  withProject(
    {
      mode: "subscription",
      line_items: [{ price: recurringPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: { metadata: { project } },
    },
    project,
  ),
);
```

`withProject` merges `project` into the object you pass it. For a one-time Checkout payment, use `payment_intent_data.metadata.project` if you subscribe to `payment_intent.*`. For subscription invoices, recent Stripe API versions expose copied Subscription metadata under `parent.subscription_details.metadata`. The standard rule checks top-level resource metadata, so route invoice events through an explicit invoice pattern or look up the project in your own application. Verify the payloads for the Stripe API version configured on your destination. [Stripe metadata and propagation](https://docs.stripe.com/metadata)

## Duplicate delivery and recovery

Lambda receives the Stripe event at `event.detail`. If you use `StripeIdempotencyStore`, pass `event.detail.id`, which is the Stripe event ID. The outer `event.id` belongs to EventBridge. Here the handler only records receipt.

```ts
import { StripeIdempotencyStore } from "@martzmakes/stripe-events/runtime";

const store = new StripeIdempotencyStore({
  tableName: process.env.IDEMPOTENCY_TABLE!,
});

export async function handler(event: { detail: { id: string } }) {
  await store.process(event.detail.id, async () => {
    console.info("Received Stripe event", event.detail.id);
  });
}
```

`process()` atomically claims the key with a conditional `PutItem` **before** invoking the callback. A callback failure leaves the claim in place, so a retry or archive replay skips that callback while the marker exists. The default TTL is 30 days and DynamoDB deletes expired items asynchronously. A shared table suppresses duplicate IDs across consumers that use the same key. If multiple independent consumers intentionally process the same event, give each consumer its own key prefix or table.

For billing writes that must retry safely, make the business operation idempotent, such as persisting the event ID in the same transaction as the entitlement change. Check current Stripe state when fulfillment depends on payment status or events can arrive out of order. [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment)

For delayed payment methods, handle `checkout.session.async_payment_succeeded` as appropriate and check `payment_status` before fulfilling on `checkout.session.completed`.

## Monitor and replay

- **Missing project tag.** Add one `StripeUnroutedEventsRule` to the root stack. It sends events with no `metadata.project` to a target you configure, such as SQS. Filter its `eventTypes` to the events you expect to tag. A present but unknown tag is outside the missing-tag rule. Check the archive or bus logs when investigating those events.
- **EventBridge delivery failures.** The consumer's `deadLetterQueue` captures events that EventBridge could not deliver to the Lambda target. Configure a separate Lambda asynchronous failure destination for errors after Lambda accepts an invocation. [EventBridge DLQs](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html) · [Lambda asynchronous errors](https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-error-handling.html)
- **Rule metrics.** In CloudWatch `AWS/Events`, look up the series by the exact partner `EventBusName` and `RuleName` when inspecting partner-bus rule traffic. Check the bus and time window before treating missing datapoints as zero. [EventBridge metrics](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-monitoring.html)
- **Archive replay.** Replay events to selected rules on the source bus. The same routing and deduplication logic applies, so plan how you will recover any events that were claimed before a callback failed. The archive and queues may contain customer data. Set retention and access accordingly. [EventBridge replay](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-replay-archived-event.html) · [Data handling](./SECURITY.md)

## Run the examples

From the repository root, use Node.js 22 or 24 and run:

```sh
npm ci
npm run check
npm run synth:examples
```

This synthesizes [the root stack](./examples/root-stack/app.ts) and [the consumer stack](./examples/consumer/app.ts) locally without AWS credentials. The templates appear under `cdk.out/root` and `cdk.out/consumer`. The root owns the shared bus and missing-tag queue. The consumer owns its Lambda and delivery DLQ.

To try an actual deployment, use a bootstrapped AWS account and Region. Set an AWS profile or credentials for that environment, create a Stripe sandbox destination, and export its actual partner source name. Run these commands from the repository root.

```sh
export STRIPE_PARTNER_SOURCE='aws.partner/stripe.com/ed_replace_me'
export STRIPE_ENV_NAME=test
export STRIPE_PROJECT=project-a

npx cdk deploy --app 'npx --no-install tsx examples/root-stack/app.ts' --output cdk.out/root
npx cdk deploy --app 'npx --no-install tsx examples/consumer/app.ts' --output cdk.out/consumer
```

Replace the placeholder before running the first deploy command. Complete a tagged Checkout in the sandbox to exercise the consumer. Check the Lambda log for the Stripe event ID, then try an untagged Checkout to check the unrouted queue for the selected event type. Confirm that the Checkout or Subscription object in Stripe has the expected metadata.

## Adopt in an existing project

If you already have a shared partner bus, keep its root stack. Point your consumer at the existing SSM prefix or pass the bus and partner source to `StripeEventRule`. Preserve your project tag, event types, and fulfillment logic when replacing an existing rule.

Run `cdk diff` before changing a live stack. Replacing a hand-written rule or a `StripeEventRule` with `StripeProjectConsumer` may change its CloudFormation logical ID. For an existing webhook cutover, prove the new route with known events first. Keep a single writer for business effects unless the old and new paths share an idempotent operation.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development and release steps, [SECURITY.md](./SECURITY.md) for reporting and data handling, and [SUPPORT.md](./SUPPORT.md) for support.

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE). Stripe, AWS, and Amazon EventBridge are trademarks of their respective owners.
