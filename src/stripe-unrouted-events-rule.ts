import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import type { StripeEventType } from "./event-types.js";
import { defaultSsmPrefix, ssmParamName } from "./ssm-keys.js";
import type { StripeEventRuleSsmLookup } from "./stripe-event-rule.js";

/** Props for {@link StripeUnroutedEventsRule}. */
export interface StripeUnroutedEventsRuleProps {
  /** The ingestion bus. Supply this (with `partnerSourceName`) **or** `fromSsm`. */
  readonly bus?: events.IEventBus;

  /** Resolve the bus and partner source from SSM. Supply this **or** `bus`. */
  readonly fromSsm?: StripeEventRuleSsmLookup;

  /** The partner source name; required with `bus`, read from SSM otherwise. */
  readonly partnerSourceName?: string;

  /**
   * Restrict to these event types. @default all event types from the source
   */
  readonly eventTypes?: (StripeEventType | string)[];

  /** Where unrouted events go. Supply this **or** `handler`. An SQS queue is the usual choice. */
  readonly target?: events.IRuleTarget;

  /** A Lambda to invoke for unrouted events. Supply this **or** `target`. */
  readonly handler?: lambda.IFunction;

  /** A queue to receive unrouted events directly (shorthand for `target: new SqsQueue(queue)`). */
  readonly queue?: sqs.IQueue;

  /** Optional explicit rule name. */
  readonly ruleName?: string;
}

/**
 * Catch events that **no project rule can match**: Stripe objects created without
 * a `metadata.project` tag. Without this rule those events are delivered to the
 * bus and silently dropped by every {@link StripeEventRule}, and the only trace
 * is the bus archive.
 *
 * Deploy one per ingestion bus, pointed at an SQS queue (or a Lambda that
 * alerts). Seeing a message here means some code path created a Stripe object
 * without `withProject(...)`.
 *
 * @example
 * ```ts
 * const unrouted = new sqs.Queue(this, "StripeUnrouted", {
 *   retentionPeriod: Duration.days(14),
 * });
 * StripeUnroutedEventsRule.fromSsm(this, "Unrouted", {
 *   envName: "live",
 *   queue: unrouted,
 * });
 * ```
 */
export class StripeUnroutedEventsRule extends Construct {
  /** The underlying EventBridge rule. */
  public readonly rule: events.Rule;

  /** The partner source name the rule matches on. */
  public readonly partnerSourceName: string;

  constructor(
    scope: Construct,
    id: string,
    props: StripeUnroutedEventsRuleProps,
  ) {
    super(scope, id);

    const { bus, partnerSourceName, busArn } = resolveBus(this, props);
    this.partnerSourceName = partnerSourceName;

    const eventPattern: events.EventPattern = {
      source: [partnerSourceName],
      ...(props.eventTypes ? { detailType: [...props.eventTypes] } : {}),
      detail: {
        data: {
          object: {
            metadata: {
              // EventBridge "exists" matcher: matches when the field is absent.
              project: [{ exists: false }],
            },
          },
        },
      },
    };

    this.rule = new events.Rule(this, "Rule", {
      eventBus: bus,
      ruleName: props.ruleName,
      description: "Stripe events with no metadata.project (unrouted)",
      eventPattern,
      targets: resolveTargets(props),
    });

    // Partner buses must be referenced by ARN (names starting with "aws." are
    // rejected by EventBridge for rules). Same workaround as StripeEventRule.
    (this.rule.node.defaultChild as events.CfnRule).eventBusName = busArn;
  }

  /** Discover the bus and partner source from SSM parameters written by `StripeIngestion`. */
  public static fromSsm(
    scope: Construct,
    id: string,
    props: Omit<StripeUnroutedEventsRuleProps, "bus" | "fromSsm"> &
      StripeEventRuleSsmLookup,
  ): StripeUnroutedEventsRule {
    const { envName, ssmPrefix, ...rest } = props;
    return new StripeUnroutedEventsRule(scope, id, {
      ...rest,
      fromSsm: { envName, ssmPrefix },
    });
  }
}

function resolveBus(
  scope: Construct,
  props: StripeUnroutedEventsRuleProps,
): { bus: events.IEventBus; partnerSourceName: string; busArn: string } {
  if (props.bus && props.fromSsm) {
    throw new Error(
      "StripeUnroutedEventsRule: supply either `bus` or `fromSsm`, not both.",
    );
  }
  if (props.bus) {
    if (!props.partnerSourceName) {
      throw new Error(
        "StripeUnroutedEventsRule: `partnerSourceName` is required when `bus` is supplied directly.",
      );
    }
    return {
      bus: props.bus,
      partnerSourceName: props.partnerSourceName,
      busArn: props.bus.eventBusArn,
    };
  }
  if (props.fromSsm) {
    const prefix =
      props.fromSsm.ssmPrefix ?? defaultSsmPrefix(props.fromSsm.envName);
    const busArn = ssm.StringParameter.valueForStringParameter(
      scope,
      ssmParamName(prefix, "busArn"),
    );
    const bus = events.EventBus.fromEventBusArn(scope, "ImportedBus", busArn);
    const partnerSourceName =
      props.partnerSourceName ??
      ssm.StringParameter.valueForStringParameter(
        scope,
        ssmParamName(prefix, "partnerSourceName"),
      );
    return { bus, partnerSourceName, busArn };
  }
  throw new Error(
    "StripeUnroutedEventsRule: one of `bus` or `fromSsm` is required.",
  );
}

function resolveTargets(
  props: StripeUnroutedEventsRuleProps,
): events.IRuleTarget[] {
  const chosen = [props.target, props.handler, props.queue].filter(Boolean);
  if (chosen.length !== 1) {
    throw new Error(
      "StripeUnroutedEventsRule: supply exactly one of `target`, `handler`, or `queue`.",
    );
  }
  if (props.target) return [props.target];
  if (props.handler) return [new targets.LambdaFunction(props.handler)];
  return [new targets.SqsQueue(props.queue!)];
}
