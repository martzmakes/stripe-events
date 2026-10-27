import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import type { StripeEventType } from "./event-types.js";
import { defaultSsmPrefix, ssmParamName } from "./ssm-keys.js";

/** How to discover the ingestion bus from SSM (written by {@link StripeIngestion}). */
export interface StripeEventRuleSsmLookup {
  /** Environment label used to derive the default SSM prefix, e.g. `"live"`. */
  readonly envName: string;
  /**
   * Override the SSM prefix.
   * @default `/stripe/${envName}`
   */
  readonly ssmPrefix?: string;
}

/** Props for {@link StripeEventRule}. */
export interface StripeEventRuleProps {
  /**
   * The ingestion bus to attach the rule to. Supply this **or** {@link fromSsm}.
   * When supplied directly you must also supply {@link partnerSourceName}.
   */
  readonly bus?: events.IEventBus;

  /**
   * Resolve the bus (and partner source) from SSM parameters published by
   * {@link StripeIngestion}. Supply this **or** {@link bus}. Prefer the
   * {@link StripeEventRule.fromSsm} static factory for this path.
   */
  readonly fromSsm?: StripeEventRuleSsmLookup;

  /**
   * The Stripe partner source name (the EventBridge `source`). Required when
   * {@link bus} is supplied directly; read from SSM otherwise.
   */
  readonly partnerSourceName?: string;

  /** The `metadata.project` value to match — your project's tag. */
  readonly project: string;

  /** Stripe event types to match (the EventBridge `detail-type`). */
  readonly eventTypes: (StripeEventType | string)[];

  /** A ready-made rule target. Supply this or {@link handler}. */
  readonly target?: events.IRuleTarget;

  /** A Lambda to invoke; wrapped in a `LambdaFunction` target for you. */
  readonly handler?: lambda.IFunction;

  /** Optional extra EventPattern, deep-merged into the generated pattern. */
  readonly extraEventPattern?: events.EventPattern;

  /** Optional explicit rule name. */
  readonly ruleName?: string;

  /** Optional rule description. */
  readonly description?: string;
}

/** Props for {@link StripeEventRule.fromSsm}. */
export type StripeEventRuleFromSsmProps = Omit<
  StripeEventRuleProps,
  "bus" | "fromSsm"
> &
  StripeEventRuleSsmLookup;

/**
 * Subscribe a consuming project to its slice of the shared Stripe event stream.
 *
 * It builds an `events.Rule` on the ingestion bus matching only events whose
 * `detail.data.object.metadata.project` equals {@link StripeEventRuleProps.project}
 * across the listed event types:
 *
 * ```jsonc
 * {
 *   "source": ["aws.partner/stripe.com/ed_xxx"],
 *   "detail-type": ["checkout.session.completed", ...],
 *   "detail": { "data": { "object": { "metadata": { "project": ["my-project"] } } } }
 * }
 * ```
 *
 * Use {@link StripeEventRule.fromSsm} so a consuming repo never has to import the
 * root stack.
 *
 * @example
 * ```ts
 * StripeEventRule.fromSsm(this, "Sub", {
 *   envName: "live",
 *   project: "project-a",
 *   eventTypes: [StripeEventType.CheckoutSessionCompleted],
 *   handler: myFn,
 * });
 * ```
 */
export class StripeEventRule extends Construct {
  /** The underlying EventBridge rule. */
  public readonly rule: events.Rule;

  /** The partner source name the rule matches on. */
  public readonly partnerSourceName: string;

  /** The `metadata.project` value the rule matches. */
  public readonly project: string;

  constructor(scope: Construct, id: string, props: StripeEventRuleProps) {
    super(scope, id);

    const { bus, partnerSourceName, busArn } = StripeEventRule.resolveBus(
      this,
      props,
    );
    this.partnerSourceName = partnerSourceName;
    this.project = props.project;

    const basePattern: events.EventPattern = {
      source: [partnerSourceName],
      detailType: [...props.eventTypes],
      detail: {
        data: { object: { metadata: { project: [props.project] } } },
      },
    };

    const eventPattern = props.extraEventPattern
      ? deepMergeEventPattern(basePattern, props.extraEventPattern)
      : basePattern;

    const ruleTargets = StripeEventRule.resolveTargets(props);

    this.rule = new events.Rule(this, "Rule", {
      eventBus: bus,
      ruleName: props.ruleName,
      description: props.description,
      eventPattern,
      targets: ruleTargets,
    });

    // A Stripe partner event bus is named `aws.partner/stripe.com/ed_xxx`, and
    // EventBridge rejects a Rule whose EventBusName starts with "aws.". The
    // EventBusName property also accepts an ARN, which is always valid — so we
    // reference the bus by ARN. (CDK's imported-bus path otherwise emits the
    // name, which fails for partner buses.)
    (this.rule.node.defaultChild as events.CfnRule).eventBusName = busArn;
  }

  /**
   * Build a {@link StripeEventRule} that discovers the ingestion bus + partner
   * source from the SSM parameters published by {@link StripeIngestion}, so the
   * consuming repo never imports the root stack.
   */
  public static fromSsm(
    scope: Construct,
    id: string,
    props: StripeEventRuleFromSsmProps,
  ): StripeEventRule {
    const { envName, ssmPrefix, ...rest } = props;
    return new StripeEventRule(scope, id, {
      ...rest,
      fromSsm: { envName, ssmPrefix },
    });
  }

  private static resolveBus(
    scope: Construct,
    props: StripeEventRuleProps,
  ): { bus: events.IEventBus; partnerSourceName: string; busArn: string } {
    if (props.bus && props.fromSsm) {
      throw new Error(
        "StripeEventRule: supply either `bus` or `fromSsm`, not both.",
      );
    }

    if (props.bus) {
      if (!props.partnerSourceName) {
        throw new Error(
          "StripeEventRule: `partnerSourceName` is required when `bus` is " +
            "supplied directly (it cannot be read from SSM in that mode).",
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

    throw new Error("StripeEventRule: one of `bus` or `fromSsm` is required.");
  }

  private static resolveTargets(
    props: StripeEventRuleProps,
  ): events.IRuleTarget[] | undefined {
    if (props.target && props.handler) {
      throw new Error(
        "StripeEventRule: supply either `target` or `handler`, not both.",
      );
    }
    if (props.target) return [props.target];
    if (props.handler) return [new targets.LambdaFunction(props.handler)];
    return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep-merge an extra EventPattern into a base one: nested objects merge
 * recursively, while arrays and primitives from `extra` override the base. This
 * lets callers add constraints at new paths (e.g. another `detail` field)
 * without clobbering the generated `source` / `detail-type` / `project` filter.
 */
export function deepMergeEventPattern(
  base: events.EventPattern,
  extra: events.EventPattern,
): events.EventPattern {
  return deepMerge(
    base as Record<string, unknown>,
    extra as Record<string, unknown>,
  ) as events.EventPattern;
}

function deepMerge(
  base: Record<string, unknown>,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, extraValue] of Object.entries(extra)) {
    const baseValue = out[key];
    if (isPlainObject(baseValue) && isPlainObject(extraValue)) {
      out[key] = deepMerge(baseValue, extraValue);
    } else {
      out[key] = extraValue;
    }
  }
  return out;
}
