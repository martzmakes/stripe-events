import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as events from "aws-cdk-lib/aws-events";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { describe, expect, it } from "vitest";
import { StripeEventRule, StripeEventType } from "../src/index.js";

const PARTNER_SOURCE = "aws.partner/stripe.com/ed_test123";

function makeStack() {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const fn = new lambda.Function(stack, "Fn", {
    runtime: lambda.Runtime.NODEJS_18_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {};"),
  });
  return { stack, fn };
}

describe("StripeEventRule", () => {
  it("builds the project-scoped event pattern", () => {
    const { stack, fn } = makeStack();
    const bus = new events.EventBus(stack, "Bus", { eventBusName: "test-bus" });
    new StripeEventRule(stack, "Rule", {
      bus,
      partnerSourceName: PARTNER_SOURCE,
      project: "proj-a",
      eventTypes: [
        StripeEventType.CheckoutSessionCompleted,
        "invoice.payment_failed",
      ],
      handler: fn,
    });

    Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        source: [PARTNER_SOURCE],
        "detail-type": ["checkout.session.completed", "invoice.payment_failed"],
        detail: { data: { object: { metadata: { project: ["proj-a"] } } } },
      },
    });
  });

  it("references the bus by ARN, not name (partner buses reject aws.* names)", () => {
    const { stack, fn } = makeStack();
    const bus = new events.EventBus(stack, "Bus", { eventBusName: "test-bus" });
    new StripeEventRule(stack, "Rule", {
      bus,
      partnerSourceName: PARTNER_SOURCE,
      project: "proj-a",
      eventTypes: [StripeEventType.CheckoutSessionCompleted],
      handler: fn,
    });
    // EventBusName must be the ARN (Fn::GetAtt), never the bus name string.
    Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      EventBusName: { "Fn::GetAtt": [Match.stringLikeRegexp("Bus"), "Arn"] },
    });
  });

  it("wraps a handler in a Lambda target and grants invoke permission", () => {
    const { stack, fn } = makeStack();
    const bus = new events.EventBus(stack, "Bus", { eventBusName: "test-bus" });
    new StripeEventRule(stack, "Rule", {
      bus,
      partnerSourceName: PARTNER_SOURCE,
      project: "proj-a",
      eventTypes: [StripeEventType.CheckoutSessionCompleted],
      handler: fn,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::Events::Rule", {
      Targets: Match.arrayWith([Match.objectLike({ Arn: Match.anyValue() })]),
    });
    template.hasResourceProperties("AWS::Lambda::Permission", {
      Action: "lambda:InvokeFunction",
      Principal: "events.amazonaws.com",
    });
  });

  it("deep-merges extraEventPattern without clobbering the project filter", () => {
    const { stack, fn } = makeStack();
    const bus = new events.EventBus(stack, "Bus", { eventBusName: "test-bus" });
    new StripeEventRule(stack, "Rule", {
      bus,
      partnerSourceName: PARTNER_SOURCE,
      project: "proj-a",
      eventTypes: [StripeEventType.CheckoutSessionCompleted],
      handler: fn,
      extraEventPattern: {
        detail: {
          data: { object: { amount_total: [{ numeric: [">", 1000] }] } },
        },
      },
    });

    Template.fromStack(stack).hasResourceProperties("AWS::Events::Rule", {
      EventPattern: {
        detail: {
          data: {
            object: {
              metadata: { project: ["proj-a"] },
              amount_total: [{ numeric: [">", 1000] }],
            },
          },
        },
      },
    });
  });

  it("refuses an extraEventPattern that would widen the project filter", () => {
    const { stack, fn } = makeStack();
    const bus = new events.EventBus(stack, "Bus", { eventBusName: "test-bus" });
    expect(
      () =>
        new StripeEventRule(stack, "Widen", {
          bus,
          partnerSourceName: PARTNER_SOURCE,
          project: "proj-a",
          eventTypes: [StripeEventType.CheckoutSessionCompleted],
          handler: fn,
          extraEventPattern: {
            detail: { data: { object: { metadata: { project: ["proj-b"] } } } },
          },
        }),
    ).toThrow(/metadata\.project/);
    expect(
      () =>
        new StripeEventRule(stack, "Source", {
          bus,
          partnerSourceName: PARTNER_SOURCE,
          project: "proj-a",
          eventTypes: [StripeEventType.CheckoutSessionCompleted],
          handler: fn,
          extraEventPattern: { source: ["aws.partner/stripe.com/ed_other"] },
        }),
    ).toThrow(/source/);
  });

  it("validates project and eventTypes", () => {
    const { stack, fn } = makeStack();
    const bus = new events.EventBus(stack, "Bus", { eventBusName: "test-bus" });
    expect(
      () =>
        new StripeEventRule(stack, "Empty", {
          bus,
          partnerSourceName: PARTNER_SOURCE,
          project: " ",
          eventTypes: ["checkout.session.completed"],
          handler: fn,
        }),
    ).toThrow(/project/);
    expect(
      () =>
        new StripeEventRule(stack, "NoTypes", {
          bus,
          partnerSourceName: PARTNER_SOURCE,
          project: "proj-a",
          eventTypes: [],
          handler: fn,
        }),
    ).toThrow(/eventTypes/);
  });

  it("throws when bus is supplied without partnerSourceName", () => {
    const { stack } = makeStack();
    const bus = new events.EventBus(stack, "Bus", { eventBusName: "test-bus" });
    expect(
      () =>
        new StripeEventRule(stack, "Rule", {
          bus,
          project: "proj-a",
          eventTypes: [StripeEventType.CheckoutSessionCompleted],
        }),
    ).toThrow(/partnerSourceName/);
  });

  it("throws when both target and handler are supplied", () => {
    const { stack, fn } = makeStack();
    const bus = new events.EventBus(stack, "Bus", { eventBusName: "test-bus" });
    expect(
      () =>
        new StripeEventRule(stack, "Rule", {
          bus,
          partnerSourceName: PARTNER_SOURCE,
          project: "proj-a",
          eventTypes: [StripeEventType.CheckoutSessionCompleted],
          handler: fn,
          target: { bind: () => ({ id: "x", arn: "arn:aws:lambda:::x" }) },
        }),
    ).toThrow(/not both/);
  });

  describe("fromSsm", () => {
    it("resolves the bus and partner source from SSM and builds the rule", () => {
      const { stack, fn } = makeStack();
      StripeEventRule.fromSsm(stack, "Sub", {
        envName: "live",
        project: "proj-a",
        eventTypes: [StripeEventType.CheckoutSessionCompleted],
        handler: fn,
      });

      const template = Template.fromStack(stack);

      // The rule carries the project filter.
      template.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: {
          detail: { data: { object: { metadata: { project: ["proj-a"] } } } },
        },
      });

      // The SSM lookups are wired as CFN parameters at the default prefix.
      const params = template.findParameters("*");
      const defaults = Object.values(params).map((p) => p.Default);
      expect(defaults).toContain("/stripe/live/bus-arn");
      expect(defaults).toContain("/stripe/live/partner-source-name");
    });

    it("honors a custom ssmPrefix", () => {
      const { stack, fn } = makeStack();
      StripeEventRule.fromSsm(stack, "Sub", {
        envName: "live",
        ssmPrefix: "/custom/sp",
        project: "proj-a",
        eventTypes: [StripeEventType.CheckoutSessionCompleted],
        handler: fn,
      });

      const params = Template.fromStack(stack).findParameters("*");
      const defaults = Object.values(params).map((p) => p.Default);
      expect(defaults).toContain("/custom/sp/bus-arn");
    });
  });
});
