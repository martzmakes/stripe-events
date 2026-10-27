/**
 * Common Stripe event-type strings, surfaced as a `const` object for editor
 * autocomplete.
 *
 * In the native Stripe → Amazon EventBridge integration these strings arrive as
 * the EventBridge `detail-type` (e.g. `"customer.subscription.updated"`), so
 * they are exactly what {@link StripeEventRule} matches against.
 *
 * This is intentionally a *partial* list of the most common families
 * (checkout, customer, subscription, invoice, payment_intent, charge, dispute).
 * Stripe ships hundreds of event types and adds more over time, so the
 * {@link StripeEventType} type also accepts any arbitrary string — never let an
 * unlisted event type block you.
 *
 * @example
 * ```ts
 * new StripeEventRule(this, "Rule", {
 *   // ...
 *   eventTypes: [
 *     StripeEventType.CheckoutSessionCompleted,
 *     "invoice.payment_failed", // arbitrary strings are fine too
 *   ],
 * });
 * ```
 */
export const StripeEventType = {
  // ---- checkout -----------------------------------------------------------
  CheckoutSessionCompleted: "checkout.session.completed",
  CheckoutSessionExpired: "checkout.session.expired",
  CheckoutSessionAsyncPaymentSucceeded:
    "checkout.session.async_payment_succeeded",
  CheckoutSessionAsyncPaymentFailed: "checkout.session.async_payment_failed",

  // ---- customer -----------------------------------------------------------
  CustomerCreated: "customer.created",
  CustomerUpdated: "customer.updated",
  CustomerDeleted: "customer.deleted",

  // ---- subscription -------------------------------------------------------
  CustomerSubscriptionCreated: "customer.subscription.created",
  CustomerSubscriptionUpdated: "customer.subscription.updated",
  CustomerSubscriptionDeleted: "customer.subscription.deleted",
  CustomerSubscriptionPaused: "customer.subscription.paused",
  CustomerSubscriptionResumed: "customer.subscription.resumed",
  CustomerSubscriptionTrialWillEnd: "customer.subscription.trial_will_end",

  // ---- invoice ------------------------------------------------------------
  InvoiceCreated: "invoice.created",
  InvoiceFinalized: "invoice.finalized",
  InvoicePaid: "invoice.paid",
  InvoicePaymentSucceeded: "invoice.payment_succeeded",
  InvoicePaymentFailed: "invoice.payment_failed",
  InvoiceUpcoming: "invoice.upcoming",
  InvoiceMarkedUncollectible: "invoice.marked_uncollectible",

  // ---- payment_intent -----------------------------------------------------
  PaymentIntentCreated: "payment_intent.created",
  PaymentIntentSucceeded: "payment_intent.succeeded",
  PaymentIntentProcessing: "payment_intent.processing",
  PaymentIntentPaymentFailed: "payment_intent.payment_failed",
  PaymentIntentCanceled: "payment_intent.canceled",

  // ---- charge -------------------------------------------------------------
  ChargeSucceeded: "charge.succeeded",
  ChargeFailed: "charge.failed",
  ChargeRefunded: "charge.refunded",
  ChargeCaptured: "charge.captured",
  ChargeExpired: "charge.expired",

  // ---- dispute ------------------------------------------------------------
  ChargeDisputeCreated: "charge.dispute.created",
  ChargeDisputeUpdated: "charge.dispute.updated",
  ChargeDisputeClosed: "charge.dispute.closed",
  ChargeDisputeFundsWithdrawn: "charge.dispute.funds_withdrawn",
  ChargeDisputeFundsReinstated: "charge.dispute.funds_reinstated",
} as const;

/**
 * A known Stripe event-type string (see {@link StripeEventType}) **or** any
 * other string. The `string & {}` member preserves autocomplete on the known
 * values while still accepting arbitrary event types Stripe may emit.
 */
export type StripeEventType =
  | (typeof StripeEventType)[keyof typeof StripeEventType]
  | (string & {});
