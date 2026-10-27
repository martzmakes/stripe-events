/**
 * `@martzmakes/stripe-events/runtime` — Lambda-side helpers for consuming Stripe events
 * delivered via Amazon EventBridge.
 *
 * EventBridge delivery is **at-least-once**, so every handler must dedupe on
 * Stripe's `event.id`. {@link StripeIdempotencyStore} wraps a single conditional
 * DynamoDB write to do exactly that, safely under concurrency.
 *
 * This entry point depends only on `@aws-sdk/client-dynamodb` — never on
 * `aws-cdk-lib` — so importing it into a Lambda bundle stays lean.
 *
 * @packageDocumentation
 */

import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

/** Default idempotency TTL: 30 days (in seconds). */
export const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Options for {@link StripeIdempotencyStore}. */
export interface StripeIdempotencyStoreOptions {
  /** The DynamoDB table name (from `StripeIngestion`'s SSM param or env var). */
  tableName: string;
  /** Reuse an existing client; one is created if omitted. */
  client?: DynamoDBClient;
  /**
   * How long a processed-event marker lives before TTL cleanup.
   * @default {@link DEFAULT_TTL_SECONDS} (30 days)
   */
  ttlSeconds?: number;
}

/**
 * Conditional-write dedupe over a DynamoDB table with an `eventId` partition key
 * and a `ttl` time-to-live attribute (exactly the table {@link StripeIngestion}
 * provisions).
 *
 * @example
 * ```ts
 * const store = new StripeIdempotencyStore({ tableName: process.env.TABLE! });
 *
 * export const handler = async (event: EventBridgeEvent<string, any>) => {
 *   const stripeEventId = event.detail.id;
 *   await store.process(stripeEventId, async () => {
 *     // ... your side effects, run at most once per Stripe event.id ...
 *   });
 * };
 * ```
 */
export class StripeIdempotencyStore {
  private readonly client: DynamoDBClient;
  private readonly tableName: string;
  private readonly ttlSeconds: number;

  constructor(options: StripeIdempotencyStoreOptions) {
    if (!options.tableName) {
      throw new Error("StripeIdempotencyStore: `tableName` is required.");
    }
    this.tableName = options.tableName;
    this.client = options.client ?? new DynamoDBClient({});
    this.ttlSeconds = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  }

  /**
   * Atomically claim an `eventId`.
   *
   * @returns `true` if this is the first time the id was seen (the caller
   * **should** process it), or `false` if it was already processed (the caller
   * **should** skip). Relies on a conditional `PutItem` — safe under concurrent
   * redeliveries, no read-then-write race.
   */
  async markProcessed(eventId: string): Promise<boolean> {
    if (!eventId) {
      throw new Error("StripeIdempotencyStore: `eventId` is required.");
    }
    const ttl = Math.floor(Date.now() / 1000) + this.ttlSeconds;
    try {
      await this.client.send(
        new PutItemCommand({
          TableName: this.tableName,
          Item: {
            eventId: { S: eventId },
            ttl: { N: String(ttl) },
          },
          ConditionExpression: "attribute_not_exists(eventId)",
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        return false;
      }
      throw err;
    }
  }

  /**
   * Run `fn` at most once per `eventId`. Returns `fn`'s result on first sight,
   * or `undefined` if the event was already processed.
   *
   * Note: the marker is written *before* `fn` runs, so if `fn` throws the event
   * is still recorded as seen. For most webhook side effects (which should be
   * idempotent on their own) this at-most-once-attempt behavior is the safer
   * default; if you need retry-on-failure, call {@link markProcessed} yourself
   * and order the write to suit.
   */
  async process<T>(
    eventId: string,
    fn: () => Promise<T>,
  ): Promise<T | undefined> {
    const first = await this.markProcessed(eventId);
    if (!first) return undefined;
    return fn();
  }
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: string }).name === "ConditionalCheckFailedException"
  );
}

/**
 * Inject `metadata.project` into a Stripe params object before you create an
 * object (Checkout Session, Customer, Subscription, PaymentIntent, ...).
 *
 * Routing in this architecture depends entirely on this tag: an object created
 * **without** `metadata.project` will not match any {@link StripeEventRule}, so
 * tag *every* object your app creates.
 *
 * @example
 * ```ts
 * await stripe.checkout.sessions.create(
 *   withProject({ mode: "payment", line_items: [...] }, "project-a"),
 * );
 * ```
 */
export function withProject<T extends object>(
  params: T,
  project: string,
): T & { metadata: Record<string, string> } {
  const existing =
    "metadata" in params && params.metadata
      ? (params.metadata as Record<string, string>)
      : {};
  return {
    ...params,
    metadata: { ...existing, project },
  };
}
