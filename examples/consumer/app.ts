/**
 * Example: a consuming project's stack.
 *
 * It never imports the root stack — it discovers the shared bus, partner source,
 * and idempotency table purely from SSM (written by `StripeIngestion`). This is
 * the pattern each consuming project uses to
 * subscribe to *its own* slice of the Stripe event stream.
 *
 * Illustrative — deploy after the root stack exists in the same account/region.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { App, Stack } from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import {
  StripeEventRule,
  StripeEventType,
  ssmParamName,
} from "@martzmakes/stripe-events";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENV_NAME = "live";
const SSM_PREFIX = `/stripe/${ENV_NAME}`;
const PROJECT = "my-project"; // the metadata.project tag your app stamps

const app = new App();
const stack = new Stack(app, "MyProjectStripeStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

// Discover the idempotency table from SSM and import it so we can grant the
// handler access (cross-stack, without importing the root stack).
const idempotencyTableName = ssm.StringParameter.valueForStringParameter(
  stack,
  ssmParamName(SSM_PREFIX, "idempotencyTableName"),
);
const idempotencyTable = dynamodb.Table.fromTableName(
  stack,
  "IdempotencyTable",
  idempotencyTableName,
);

const handler = new NodejsFunction(stack, "StripeHandler", {
  entry: path.join(__dirname, "handler.ts"),
  runtime: Runtime.NODEJS_20_X,
  environment: {
    IDEMPOTENCY_TABLE: idempotencyTableName,
  },
});
idempotencyTable.grantReadWriteData(handler);

// Subscribe to just this project's events, resolving the bus from SSM.
StripeEventRule.fromSsm(stack, "Subscription", {
  envName: ENV_NAME,
  project: PROJECT,
  eventTypes: [
    StripeEventType.CheckoutSessionCompleted,
    StripeEventType.CustomerSubscriptionDeleted,
  ],
  handler,
});
