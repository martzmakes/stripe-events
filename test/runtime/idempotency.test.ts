import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StripeIdempotencyStore,
  withProject,
} from "../../src/runtime/index.js";

const ddbMock = mockClient(DynamoDBClient);

class ConditionalCheckFailedException extends Error {
  constructor() {
    super("The conditional request failed");
    this.name = "ConditionalCheckFailedException";
  }
}

beforeEach(() => {
  ddbMock.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("StripeIdempotencyStore", () => {
  it("markProcessed returns true on first sight, false on redelivery", async () => {
    const store = new StripeIdempotencyStore({ tableName: "t" });

    ddbMock.on(PutItemCommand).resolvesOnce({}); // first write succeeds
    expect(await store.markProcessed("evt_1")).toBe(true);

    ddbMock.on(PutItemCommand).rejects(new ConditionalCheckFailedException());
    expect(await store.markProcessed("evt_1")).toBe(false);
  });

  it("writes a conditional put with eventId and a ttl", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const store = new StripeIdempotencyStore({ tableName: "my-table" });
    ddbMock.on(PutItemCommand).resolves({});

    await store.markProcessed("evt_42");

    const calls = ddbMock.commandCalls(PutItemCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input;
    expect(input.TableName).toBe("my-table");
    expect(input.ConditionExpression).toBe("attribute_not_exists(eventId)");
    expect(input.Item?.eventId).toEqual({ S: "evt_42" });
    const expectedTtl =
      Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000) + 30 * 24 * 60 * 60;
    expect(input.Item?.ttl).toEqual({ N: String(expectedTtl) });
  });

  it("rethrows non-conditional errors", async () => {
    const store = new StripeIdempotencyStore({ tableName: "t" });
    ddbMock.on(PutItemCommand).rejects(new Error("boom"));
    await expect(store.markProcessed("evt_1")).rejects.toThrow("boom");
  });

  it("process runs fn only on first sight", async () => {
    const store = new StripeIdempotencyStore({ tableName: "t" });
    const fn = vi.fn().mockResolvedValue("done");

    ddbMock.on(PutItemCommand).resolvesOnce({});
    expect(await store.process("evt_1", fn)).toBe("done");
    expect(fn).toHaveBeenCalledTimes(1);

    ddbMock.on(PutItemCommand).rejects(new ConditionalCheckFailedException());
    expect(await store.process("evt_1", fn)).toBeUndefined();
    expect(fn).toHaveBeenCalledTimes(1); // not called again
  });

  it("requires tableName and eventId", async () => {
    expect(() => new StripeIdempotencyStore({ tableName: "" })).toThrow(
      /tableName/,
    );
    const store = new StripeIdempotencyStore({ tableName: "t" });
    await expect(store.markProcessed("")).rejects.toThrow(/eventId/);
  });

  it("honors a custom ttlSeconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const store = new StripeIdempotencyStore({
      tableName: "t",
      ttlSeconds: 60,
    });
    ddbMock.on(PutItemCommand).resolves({});
    await store.markProcessed("evt_x");
    const input = ddbMock.commandCalls(PutItemCommand)[0]!.args[0].input;
    const expected = Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000) + 60;
    expect(input.Item?.ttl).toEqual({ N: String(expected) });
  });
});

describe("withProject", () => {
  it("injects metadata.project into a params object", () => {
    expect(withProject({ mode: "payment" }, "project-a")).toEqual({
      mode: "payment",
      metadata: { project: "project-a" },
    });
  });

  it("preserves existing metadata", () => {
    expect(
      withProject({ metadata: { email: "a@b.com" } }, "project-b"),
    ).toEqual({ metadata: { email: "a@b.com", project: "project-b" } });
  });

  it("overrides an existing project tag", () => {
    expect(withProject({ metadata: { project: "old" } }, "new")).toEqual({
      metadata: { project: "new" },
    });
  });
});
