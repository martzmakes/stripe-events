/**
 * Example: a consuming project's stack.
 *
 * It never imports the root stack. `StripeProjectConsumer` discovers the shared
 * bus, partner source, and idempotency table from SSM (written by
 * `StripeIngestion`), subscribes to this project's events, grants the handler
 * the idempotency table, and dead-letters undeliverable events.
 *
 * Illustrative; deploy after the root stack exists in the same account/region.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { App, Duration, Stack } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import {
  StripeProjectConsumer,
  StripeEventType,
  StripeUnroutedEventsRule,
} from "@martzmakes/stripe-events";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENV_NAME = "live";
const PROJECT = "my-project"; // the metadata.project tag your app stamps

const app = new App();
const stack = new Stack(app, "MyProjectStripeStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

const handler = new NodejsFunction(stack, "StripeHandler", {
  entry: path.join(__dirname, "handler.ts"),
  runtime: Runtime.NODEJS_20_X,
});

// Subscribe to just this project's events. IDEMPOTENCY_TABLE is set on the
// handler and read/write access is granted for you.
new StripeProjectConsumer(stack, "Stripe", {
  envName: ENV_NAME,
  project: PROJECT,
  eventTypes: [
    StripeEventType.CheckoutSessionCompleted,
    StripeEventType.CustomerSubscriptionDeleted,
  ],
  handler,
  deadLetterQueue: new sqs.Queue(stack, "StripeDlq", {
    retentionPeriod: Duration.days(14),
  }),
});

// One per bus, usually in the root stack: events with no metadata.project tag.
StripeUnroutedEventsRule.fromSsm(stack, "Unrouted", {
  envName: ENV_NAME,
  queue: new sqs.Queue(stack, "StripeUnrouted", {
    retentionPeriod: Duration.days(14),
  }),
});
