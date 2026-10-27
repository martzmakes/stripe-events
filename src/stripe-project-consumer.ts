import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import type { StripeEventType } from "./event-types.js";
import { defaultSsmPrefix, ssmParamName } from "./ssm-keys.js";
import { StripeEventRule } from "./stripe-event-rule.js";

/** Props for {@link StripeProjectConsumer}. */
export interface StripeProjectConsumerProps {
  /** Environment label used to derive the default SSM prefix, e.g. `"live"`. */
  readonly envName: string;

  /**
   * Override the SSM prefix written by {@link StripeIngestion}.
   * @default `/stripe/${envName}`
   */
  readonly ssmPrefix?: string;

  /** The `metadata.project` value this consumer owns. */
  readonly project: string;

  /** Stripe event types to subscribe to (the EventBridge `detail-type`). */
  readonly eventTypes: (StripeEventType | string)[];

  /** The Lambda that processes this project's events. */
  readonly handler: lambda.IFunction;

  /**
   * Grant the handler read/write access to the shared idempotency table and
   * expose its name as an environment variable. Requires the ingestion stack
   * to have created the table (the default).
   * @default true
   */
  readonly grantIdempotency?: boolean;

  /**
   * Name of the environment variable that receives the idempotency table name.
   * Only set when `handler` is a `lambda.Function` (imported functions cannot
   * have their environment changed; pass the name yourself in that case).
   * @default "IDEMPOTENCY_TABLE"
   */
  readonly idempotencyEnvVar?: string;

  /**
   * Dead-letter queue for events EventBridge could not deliver to the handler
   * after `retryAttempts`. Strongly recommended for billing consumers.
   */
  readonly deadLetterQueue?: sqs.IQueue;

  /** EventBridge delivery retries before dead-lettering. @default 185 (EventBridge default) */
  readonly retryAttempts?: number;

  /** Maximum age of an event EventBridge will keep retrying. @default 24 hours (EventBridge default) */
  readonly maxEventAge?: Duration;

  /** Optional explicit rule name. */
  readonly ruleName?: string;

  /** Optional extra EventPattern, deep-merged into the generated pattern. */
  readonly extraEventPattern?: events.EventPattern;
}

/**
 * Everything a consuming project needs to receive **its** slice of the shared
 * Stripe event stream, in one construct:
 *
 * - a {@link StripeEventRule} on the ingestion bus, discovered from SSM, that
 *   matches only this project's `metadata.project` across the listed event types;
 * - the shared idempotency table imported from SSM, granted read/write to the
 *   handler, with its name exposed as `IDEMPOTENCY_TABLE` so the handler can use
 *   `StripeIdempotencyStore` from the `/runtime` entry point;
 * - optional dead-letter queue and retry policy on the Lambda target.
 *
 * The consuming stack never imports the root stack.
 *
 * @example
 * ```ts
 * const consumer = new StripeProjectConsumer(this, "Stripe", {
 *   envName: "live",
 *   project: "project-a",
 *   eventTypes: [
 *     StripeEventType.CheckoutSessionCompleted,
 *     StripeEventType.CustomerSubscriptionDeleted,
 *   ],
 *   handler: billingFn,
 *   deadLetterQueue: new sqs.Queue(this, "StripeDlq"),
 * });
 * ```
 */
export class StripeProjectConsumer extends Construct {
  /** The routing rule for this project. */
  public readonly rule: StripeEventRule;

  /** The shared idempotency table, when `grantIdempotency` is enabled. */
  public readonly idempotencyTable?: dynamodb.ITable;

  /** The idempotency table name (an SSM-resolved token), when enabled. */
  public readonly idempotencyTableName?: string;

  constructor(scope: Construct, id: string, props: StripeProjectConsumerProps) {
    super(scope, id);

    const prefix = props.ssmPrefix ?? defaultSsmPrefix(props.envName);

    if (props.grantIdempotency ?? true) {
      this.idempotencyTableName = ssm.StringParameter.valueForStringParameter(
        this,
        ssmParamName(prefix, "idempotencyTableName"),
      );
      this.idempotencyTable = dynamodb.Table.fromTableName(
        this,
        "IdempotencyTable",
        this.idempotencyTableName,
      );
      this.idempotencyTable.grantReadWriteData(props.handler);

      if (props.handler instanceof lambda.Function) {
        props.handler.addEnvironment(
          props.idempotencyEnvVar ?? "IDEMPOTENCY_TABLE",
          this.idempotencyTableName,
        );
      }
    }

    this.rule = StripeEventRule.fromSsm(this, "Rule", {
      envName: props.envName,
      ssmPrefix: props.ssmPrefix,
      project: props.project,
      eventTypes: props.eventTypes,
      handler: props.handler,
      deadLetterQueue: props.deadLetterQueue,
      retryAttempts: props.retryAttempts,
      maxEventAge: props.maxEventAge,
      ruleName: props.ruleName,
      extraEventPattern: props.extraEventPattern,
    });
  }
}
