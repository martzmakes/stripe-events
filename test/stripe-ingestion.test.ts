import { App, Duration, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { StripeIngestion, type StripeIngestionProps } from "../src/index.js";

const PARTNER_SOURCE = "aws.partner/stripe.com/ed_test123";

function synth(props?: Partial<StripeIngestionProps>) {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new StripeIngestion(stack, "Ingestion", {
    partnerSourceName: PARTNER_SOURCE,
    envName: "test",
    ...props,
  });
  return Template.fromStack(stack);
}

describe("StripeIngestion", () => {
  it("creates an event bus bound to the partner source (Name === EventSourceName)", () => {
    const template = synth();
    template.hasResourceProperties("AWS::Events::EventBus", {
      Name: PARTNER_SOURCE,
      EventSourceName: PARTNER_SOURCE,
    });
  });

  it("creates a bus archive with the default retention and source filter", () => {
    const template = synth();
    template.hasResourceProperties("AWS::Events::Archive", {
      RetentionDays: 90,
      EventPattern: { source: [PARTNER_SOURCE] },
    });
  });

  it("honors a custom archive retention", () => {
    const template = synth({ archiveRetention: Duration.days(30) });
    template.hasResourceProperties("AWS::Events::Archive", {
      RetentionDays: 30,
    });
  });

  it("creates a PAY_PER_REQUEST idempotency table keyed on eventId with a ttl attribute", () => {
    const template = synth();
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      BillingMode: "PAY_PER_REQUEST",
      KeySchema: [{ AttributeName: "eventId", KeyType: "HASH" }],
      AttributeDefinitions: Match.arrayWith([
        { AttributeName: "eventId", AttributeType: "S" },
      ]),
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    });
  });

  it("retains the idempotency table by default", () => {
    const template = synth();
    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
    });
  });

  it("publishes the four SSM discovery parameters by default", () => {
    const template = synth();
    template.resourceCountIs("AWS::SSM::Parameter", 4);
    for (const name of [
      "/stripe/test/bus-name",
      "/stripe/test/bus-arn",
      "/stripe/test/partner-source-name",
      "/stripe/test/idempotency-table-name",
    ]) {
      template.hasResourceProperties("AWS::SSM::Parameter", { Name: name });
    }
  });

  it("honors a custom SSM prefix", () => {
    const template = synth({ ssm: { prefix: "/custom/stripe" } });
    template.hasResourceProperties("AWS::SSM::Parameter", {
      Name: "/custom/stripe/bus-arn",
    });
  });

  it("omits the archive when enableArchive is false", () => {
    const template = synth({ enableArchive: false });
    template.resourceCountIs("AWS::Events::Archive", 0);
  });

  it("omits the table (and its SSM param) when idempotency is disabled", () => {
    const template = synth({ idempotency: { enabled: false } });
    template.resourceCountIs("AWS::DynamoDB::Table", 0);
    template.resourceCountIs("AWS::SSM::Parameter", 3);
  });

  it("omits all SSM parameters when ssm is disabled", () => {
    const template = synth({ ssm: { enabled: false } });
    template.resourceCountIs("AWS::SSM::Parameter", 0);
  });

  it("emits CfnOutputs for the bus ARN and table name", () => {
    const template = synth();
    const outputs = template.findOutputs("*");
    const keys = Object.keys(outputs);
    expect(keys.some((k) => k.includes("BusArnOutput"))).toBe(true);
    expect(keys.some((k) => k.includes("IdempotencyTableNameOutput"))).toBe(
      true,
    );
  });

  it("exposes the partner source name and (when enabled) the idempotency table", () => {
    const app = new App();
    const stack = new Stack(app, "S");
    const ingestion = new StripeIngestion(stack, "Ingestion", {
      partnerSourceName: PARTNER_SOURCE,
      envName: "test",
    });
    expect(ingestion.partnerSourceName).toBe(PARTNER_SOURCE);
    expect(ingestion.idempotencyTable).toBeDefined();
  });

  it("grantIdempotency throws when the table is disabled", () => {
    const app = new App();
    const stack = new Stack(app, "S");
    const ingestion = new StripeIngestion(stack, "Ingestion", {
      partnerSourceName: PARTNER_SOURCE,
      envName: "test",
      idempotency: { enabled: false },
    });
    expect(ingestion.idempotencyTable).toBeUndefined();
    expect(() => ingestion.grantIdempotency({} as never)).toThrow(
      /idempotency table is disabled/,
    );
  });
});
