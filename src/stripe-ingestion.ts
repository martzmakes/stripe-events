import { Annotations, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import { Grant, IGrantable } from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { defaultSsmPrefix, ssmParamName } from "./ssm-keys.js";

/** Idempotency table options for {@link StripeIngestion}. */
export interface StripeIngestionIdempotencyOptions {
  /** Whether to create the dedupe table. @default true */
  readonly enabled?: boolean;
  /** Explicit table name. @default CDK-generated name */
  readonly tableName?: string;
  /**
   * Removal policy for the table. Defaults to RETAIN so that destroying the
   * stack never silently drops the record of which events were processed.
   * @default RemovalPolicy.RETAIN
   */
  readonly removalPolicy?: RemovalPolicy;
}

/** SSM publishing options for {@link StripeIngestion}. */
export interface StripeIngestionSsmOptions {
  /** Whether to publish discovery parameters to SSM. @default true */
  readonly enabled?: boolean;
  /**
   * Parameter-name prefix.
   * @default `/stripe/${envName}`
   */
  readonly prefix?: string;
}

/** Props for {@link StripeIngestion}. */
export interface StripeIngestionProps {
  /**
   * The Stripe partner event source name minted when you configure the Amazon
   * EventBridge event destination in the Stripe dashboard, e.g.
   * `aws.partner/stripe.com/ed_xxx`.
   *
   * The source stays "Pending" in the EventBridge console until this construct's
   * bus associates with it on first deploy.
   */
  readonly partnerSourceName: string;

  /**
   * Environment label, e.g. `"test"` or `"live"`. Used in resource names, the
   * archive name, and the default SSM prefix.
   */
  readonly envName: string;

  /**
   * Reserved / advanced. AWS requires a partner event bus's name to **exactly
   * equal** its partner source name, so this construct always names the bus
   * after {@link partnerSourceName}. Supplying a different value here emits a
   * synth-time warning and is otherwise ignored.
   */
  readonly eventBusName?: string;

  /**
   * Create a native EventBridge bus archive (for replay / DR) matching the
   * partner source. @default true
   */
  readonly enableArchive?: boolean;

  /** Archive retention. @default Duration.days(90) */
  readonly archiveRetention?: Duration;

  /** Idempotency (dedupe) table configuration. */
  readonly idempotency?: StripeIngestionIdempotencyOptions;

  /** SSM discovery-parameter configuration. */
  readonly ssm?: StripeIngestionSsmOptions;
}

/**
 * The shared, "root" Stripe ingestion infrastructure. Add one instance per
 * Stripe environment (test / live) to any stack.
 *
 * It stands up:
 * - an {@link https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-saas.html | EventBridge event bus} bound to the Stripe partner source,
 * - (optionally) a native bus archive for replay,
 * - (optionally) a PAY_PER_REQUEST DynamoDB table for handler-side idempotency, and
 * - (optionally) SSM parameters so consuming repos can discover the bus without
 *   importing this stack (see {@link StripeEventRule.fromSsm}).
 *
 * It does **not** create the Stripe partner source itself — that is a one-time
 * manual step in the Stripe dashboard (see the package README).
 *
 * @example
 * ```ts
 * const ingestion = new StripeIngestion(this, "StripeLive", {
 *   partnerSourceName: "aws.partner/stripe.com/ed_123",
 *   envName: "live",
 * });
 * ```
 */
export class StripeIngestion extends Construct {
  /** The event bus bound to the Stripe partner source. */
  public readonly bus: events.IEventBus;

  /** The idempotency table, when {@link StripeIngestionProps.idempotency} is enabled. */
  public readonly idempotencyTable?: dynamodb.ITable;

  /** The Stripe partner event source name this ingestion is bound to. */
  public readonly partnerSourceName: string;

  constructor(scope: Construct, id: string, props: StripeIngestionProps) {
    super(scope, id);

    const { partnerSourceName, envName } = props;
    this.partnerSourceName = partnerSourceName;

    // AWS requires a partner event bus's Name to equal its partner source name.
    if (props.eventBusName && props.eventBusName !== partnerSourceName) {
      Annotations.of(this).addWarningV2(
        "stripe-events:partner-bus-name",
        `eventBusName "${props.eventBusName}" is ignored. AWS requires a ` +
          `partner event bus name to exactly equal its partner source name ` +
          `("${partnerSourceName}").`,
      );
    }

    // Passing only `eventSourceName` tells CDK this is a partner bus; it sets
    // the bus Name to equal the source name (an AWS requirement) for us. Passing
    // both `eventBusName` and `eventSourceName` would throw.
    this.bus = new events.EventBus(this, "Bus", {
      eventSourceName: partnerSourceName,
    });

    // --- Archive (replay / DR) ---------------------------------------------
    const enableArchive = props.enableArchive ?? true;
    if (enableArchive) {
      this.bus.archive("Archive", {
        archiveName: `stripe-${envName}`,
        description: `Archive of Stripe events for ${envName}`,
        eventPattern: { source: [partnerSourceName] },
        retention: props.archiveRetention ?? Duration.days(90),
      });
    }

    // --- Idempotency table -------------------------------------------------
    const idempotencyEnabled = props.idempotency?.enabled ?? true;
    if (idempotencyEnabled) {
      this.idempotencyTable = new dynamodb.Table(this, "IdempotencyTable", {
        tableName: props.idempotency?.tableName,
        partitionKey: {
          name: "eventId",
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        timeToLiveAttribute: "ttl",
        removalPolicy: props.idempotency?.removalPolicy ?? RemovalPolicy.RETAIN,
      });
    }

    // --- SSM discovery parameters ------------------------------------------
    const ssmEnabled = props.ssm?.enabled ?? true;
    if (ssmEnabled) {
      const prefix = props.ssm?.prefix ?? defaultSsmPrefix(envName);

      new ssm.StringParameter(this, "BusNameParam", {
        parameterName: ssmParamName(prefix, "busName"),
        stringValue: this.bus.eventBusName,
      });
      new ssm.StringParameter(this, "BusArnParam", {
        parameterName: ssmParamName(prefix, "busArn"),
        stringValue: this.bus.eventBusArn,
      });
      new ssm.StringParameter(this, "PartnerSourceParam", {
        parameterName: ssmParamName(prefix, "partnerSourceName"),
        stringValue: partnerSourceName,
      });
      if (this.idempotencyTable) {
        new ssm.StringParameter(this, "IdempotencyTableParam", {
          parameterName: ssmParamName(prefix, "idempotencyTableName"),
          stringValue: this.idempotencyTable.tableName,
        });
      }
    }

    // --- Outputs -----------------------------------------------------------
    new CfnOutput(this, "BusArnOutput", {
      value: this.bus.eventBusArn,
      description: "ARN of the Stripe ingestion event bus",
    });
    if (this.idempotencyTable) {
      new CfnOutput(this, "IdempotencyTableNameOutput", {
        value: this.idempotencyTable.tableName,
        description: "Name of the Stripe idempotency table",
      });
    }
  }

  /**
   * Grant a principal (typically a consumer's handler Lambda) read/write access
   * to the idempotency table. Throws if the table was disabled.
   */
  public grantIdempotency(grantee: IGrantable): Grant {
    if (!this.idempotencyTable) {
      throw new Error(
        "Cannot grantIdempotency: the idempotency table is disabled. Set " +
          "`idempotency.enabled` (default true) to use this.",
      );
    }
    return this.idempotencyTable.grantReadWriteData(grantee);
  }
}
