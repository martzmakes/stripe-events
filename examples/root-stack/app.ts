/**
 * Example: the shared "root" Stripe ingestion stack.
 *
 * Deploy this once per AWS account (per Stripe environment). It stands up the
 * partner-bound event bus, the replay archive, the idempotency table, and the
 * SSM discovery parameters that consumer stacks read.
 *
 * Set STRIPE_PARTNER_SOURCE to your actual partner event source before deploy.
 */
import { App, Duration, Stack } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import {
  StripeEventType,
  StripeIngestion,
  StripeUnroutedEventsRule,
} from "@martzmakes/stripe-events";

const envName = process.env.STRIPE_ENV_NAME ?? "test";

const app = new App();

const stack = new Stack(app, "StripeRootStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

const ingestion = new StripeIngestion(stack, "Stripe", {
  // The fallback is for local synthesis only.
  partnerSourceName:
    process.env.STRIPE_PARTNER_SOURCE ?? "aws.partner/stripe.com/ed_replace_me",
  envName,
});

new StripeUnroutedEventsRule(stack, "Unrouted", {
  bus: ingestion.bus,
  partnerSourceName: ingestion.partnerSourceName,
  eventTypes: [
    StripeEventType.CheckoutSessionCompleted,
    StripeEventType.CustomerSubscriptionDeleted,
  ],
  queue: new Queue(stack, "StripeUnrouted", {
    retentionPeriod: Duration.days(14),
  }),
});
