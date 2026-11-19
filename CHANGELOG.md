# Changelog

## 0.1.0

- Route Stripe snapshot events on an EventBridge partner bus by event type and project tag.
- Provision the shared bus, optional replay archive and idempotency table, and SSM discovery parameters with `StripeIngestion`.
- Use `StripeProjectConsumer` to attach a Lambda with optional retry and delivery dead-letter settings. Use `StripeUnroutedEventsRule` to capture events with a missing project tag.
- Use the `/runtime` entry point to tag Stripe objects and suppress duplicate event attempts with a conditional DynamoDB write.
