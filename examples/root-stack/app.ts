/**
 * Example: the shared "root" Stripe ingestion stack.
 *
 * Deploy this once per AWS account (per Stripe environment). It stands up the
 * partner-bound event bus, the replay archive, the idempotency table, and the
 * SSM discovery parameters that consumer stacks read.
 *
 * Illustrative — to deploy for real: `npm i @martzmakes/stripe-events`, set
 * STRIPE_PARTNER_SOURCE to the source name Stripe minted, then `cdk deploy`.
 */
import { App, Stack } from "aws-cdk-lib";
import { StripeIngestion } from "@martzmakes/stripe-events";

const app = new App();

const stack = new Stack(app, "StripeRootStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

new StripeIngestion(stack, "StripeLive", {
  // The source name from Stripe's Amazon EventBridge event destination.
  partnerSourceName:
    process.env.STRIPE_PARTNER_SOURCE ?? "aws.partner/stripe.com/ed_replace_me",
  envName: "live",
  // archive + idempotency table + SSM params are all on by default.
});
