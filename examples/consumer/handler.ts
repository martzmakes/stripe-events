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
  };
}

export const handler = async (event: StripeEventBridgeEvent): Promise<void> => {
  // This example records receipt only. Put retryable billing work behind a
  // business-level idempotency key or a durable, retry-aware processing step.
  await store.process(event.detail.id, async () => {
    console.log("Received Stripe event", event["detail-type"], event.detail.id);
  });
};
