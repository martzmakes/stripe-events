/**
 * `@martzmakes/stripe-events` — AWS CDK (v2) constructs that fan one Stripe account's
 * events out to many independent projects via Amazon EventBridge, routed by
 * `metadata.project`.
 *
 * The Lambda-side idempotency helper lives in the separate `@martzmakes/stripe-events/runtime`
 * entry point to keep the AWS SDK out of your CDK synth graph.
 *
 * @packageDocumentation
 */

export {
  StripeIngestion,
  type StripeIngestionProps,
  type StripeIngestionIdempotencyOptions,
  type StripeIngestionSsmOptions,
} from "./stripe-ingestion.js";

export {
  StripeEventRule,
  deepMergeEventPattern,
  type StripeEventRuleProps,
  type StripeEventRuleFromSsmProps,
  type StripeEventRuleSsmLookup,
} from "./stripe-event-rule.js";

export { StripeEventType } from "./event-types.js";

export {
  defaultSsmPrefix,
  ssmParamName,
  SSM_KEYS,
  type SsmKey,
} from "./ssm-keys.js";
