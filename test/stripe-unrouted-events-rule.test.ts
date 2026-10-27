import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { describe, expect, it } from "vitest";
import { StripeUnroutedEventsRule } from "../src/stripe-unrouted-events-rule.js";

const SOURCE = "aws.partner/stripe.com/ed_test";

describe("StripeUnroutedEventsRule", () => {
  it("matches events whose metadata.project is absent and targets a queue", () => {
    const stack = new Stack(new App(), "S");
    const queue = new sqs.Queue(stack, "Q");
    StripeUnroutedEventsRule.fromSsm(stack, "Unrouted", {
      envName: "live",
      queue,
    });
    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: Match.objectLike({
        detail: {
          data: { object: { metadata: { project: [{ exists: false }] } } },
        },
      }),
      Targets: [Match.objectLike({ Arn: Match.anyValue() })],
    });
    // partner buses are referenced by ARN, never by name
    template.hasResourceProperties("AWS::Events::Rule", {
      EventBusName: { Ref: Match.stringLikeRegexp("SsmParameterValue") },
    });
  });

  it("accepts a direct bus plus partner source and an optional event-type filter", () => {
    const stack = new Stack(new App(), "S");
    const bus = new events.EventBus(stack, "Bus", { eventSourceName: SOURCE });
    const handler = new lambda.Function(stack, "Fn", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => {};"),
    });
    new StripeUnroutedEventsRule(stack, "Unrouted", {
      bus,
      partnerSourceName: SOURCE,
      eventTypes: ["checkout.session.completed"],
      handler,
    });
    Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      EventPattern: Match.objectLike({
        source: [SOURCE],
        "detail-type": ["checkout.session.completed"],
      }),
    });
  });

  it("rejects ambiguous target configuration", () => {
    const stack = new Stack(new App(), "S");
    const queue = new sqs.Queue(stack, "Q");
    expect(
      () =>
        new StripeUnroutedEventsRule(stack, "Bad", {
          fromSsm: { envName: "live" },
          queue,
          target: new (class implements events.IRuleTarget {
            bind() {
              return { id: "", arn: "arn:aws:sqs:us-east-1:000000000000:q" };
            }
          })(),
        }),
    ).toThrow(/exactly one/);
    expect(
      () =>
        new StripeUnroutedEventsRule(stack, "Bad2", {
          fromSsm: { envName: "live" },
        }),
    ).toThrow(/exactly one/);
  });
});
