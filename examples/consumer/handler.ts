/**
 * Example consumer handler.
 *
 * Receives a Stripe event delivered via EventBridge. The full Stripe event
 * object lives at `event.detail`, so the dedupe key is `event.detail.id`.
 */
import { StripeIdempotencyStore } from "@martzmakes/stripe-events/runtime";

const store = new StripeIdempotencyStore({
  tableName: process.env.IDEMPOTENCY_TABLE!,
});

/** Minimal shape of the EventBridge envelope for a Stripe event. */
interface StripeEventBridgeEvent {
  "detail-type": string;
  detail: {
    id: string;
    type: string;
    data: { object: Record<string, unknown> };
  };
}

export const handler = async (event: StripeEventBridgeEvent): Promise<void> => {
  const stripeEvent = event.detail;

  // at-least-once delivery → dedupe on Stripe's event.id
  await store.process(stripeEvent.id, async () => {
    const object = stripeEvent.data.object;
    // metadata.project is guaranteed to be ours — the rule already filtered.
    console.log("processing", event["detail-type"], stripeEvent.id, {
      project: (object.metadata as Record<string, string> | undefined)?.project,
    });

    // ... your side effects here (grant entitlement, update DB, etc.) ...
  });
};
