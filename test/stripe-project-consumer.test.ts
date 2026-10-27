import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { describe, expect, it } from "vitest";
import { StripeProjectConsumer } from "../src/stripe-project-consumer.js";
import { StripeEventType } from "../src/event-types.js";

function fixture(opts: { dlq?: boolean; grant?: boolean } = {}) {
  const app = new App();
  const stack = new Stack(app, "Consumer");
  const handler = new lambda.Function(stack, "Handler", {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: "index.handler",
    code: lambda.Code.fromInline("exports.handler = async () => {};"),
  });
  const consumer = new StripeProjectConsumer(stack, "Stripe", {
    envName: "live",
    project: "project-a",
    eventTypes: [StripeEventType.CheckoutSessionCompleted],
    handler,
    grantIdempotency: opts.grant,
    deadLetterQueue: opts.dlq ? new sqs.Queue(stack, "Dlq") : undefined,
    retryAttempts: opts.dlq ? 3 : undefined,
    maxEventAge: opts.dlq ? Duration.hours(2) : undefined,
  });
  return { stack, handler, consumer, template: Template.fromStack(stack) };
}

describe("StripeProjectConsumer", () => {
  it("creates one rule on the SSM-resolved bus filtered to the project", () => {
    const { template } = fixture();
    template.resourceCountIs("AWS::Events::Rule", 1);
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: Match.objectLike({
        "detail-type": ["checkout.session.completed"],
        detail: { data: { object: { metadata: { project: ["project-a"] } } } },
      }),
    });
  });

  it("reads bus ARN, partner source and table name from SSM", () => {
    const { template } = fixture();
    const params = template.findParameters("*");
    const defaults = Object.values(params).map(
      (p) => (p as { Default?: string }).Default,
    );
    expect(defaults).toEqual(
      expect.arrayContaining([
        "/stripe/live/bus-arn",
        "/stripe/live/partner-source-name",
        "/stripe/live/idempotency-table-name",
      ]),
    );
  });

  it("grants the handler read/write on the idempotency table and sets IDEMPOTENCY_TABLE", () => {
    const { template, consumer } = fixture();
    expect(consumer.idempotencyTable).toBeDefined();
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["dynamodb:PutItem"]),
            Effect: "Allow",
          }),
        ]),
      }),
    });
    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: {
        Variables: Match.objectLike({ IDEMPOTENCY_TABLE: Match.anyValue() }),
      },
    });
  });

  it("skips the table when grantIdempotency is false", () => {
    const { template, consumer } = fixture({ grant: false });
    expect(consumer.idempotencyTable).toBeUndefined();
    template.resourceCountIs("AWS::IAM::Policy", 0);
  });

  it("wires a dead-letter queue and retry policy onto the Lambda target", () => {
    const { template } = fixture({ dlq: true });
    template.hasResourceProperties("AWS::Events::Rule", {
      Targets: [
        Match.objectLike({
          DeadLetterConfig: { Arn: Match.anyValue() },
          RetryPolicy: {
            MaximumRetryAttempts: 3,
            MaximumEventAgeInSeconds: 7200,
          },
        }),
      ],
    });
  });
});
