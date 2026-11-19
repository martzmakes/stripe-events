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
} from "@martzmakes/stripe-events";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envName = process.env.STRIPE_ENV_NAME ?? "test";
const project = process.env.STRIPE_PROJECT ?? "project-a";

const app = new App();
const stack = new Stack(app, "MyProjectStripeStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

const handler = new NodejsFunction(stack, "StripeHandler", {
  entry: path.join(__dirname, "handler.ts"),
  runtime: Runtime.NODEJS_22_X,
  bundling: { bundleAwsSDK: true },
});

// Subscribe to just this project's events. IDEMPOTENCY_TABLE is set on the
// handler and dynamodb:PutItem access is granted for you.
new StripeProjectConsumer(stack, "Stripe", {
  envName,
  project,
  eventTypes: [
    StripeEventType.CheckoutSessionCompleted,
    StripeEventType.CustomerSubscriptionDeleted,
  ],
  handler,
  deadLetterQueue: new sqs.Queue(stack, "StripeDlq", {
    retentionPeriod: Duration.days(14),
  }),
});
