/**
 * Shared SSM parameter naming used by {@link StripeIngestion} (which writes the
 * parameters) and {@link StripeEventRule.fromSsm} (which reads them). Keeping
 * the keys in one place guarantees the producer and consumer never drift.
 */

/** Default SSM prefix for a given environment, e.g. `/stripe/live`. */
export function defaultSsmPrefix(envName: string): string {
  return `/stripe/${envName}`;
}

/** The leaf names appended under the SSM prefix. */
export const SSM_KEYS = {
  busName: "bus-name",
  busArn: "bus-arn",
  partnerSourceName: "partner-source-name",
  idempotencyTableName: "idempotency-table-name",
} as const;

export type SsmKey = keyof typeof SSM_KEYS;

/** Build a fully-qualified SSM parameter name from a prefix and a known key. */
export function ssmParamName(prefix: string, key: SsmKey): string {
  return `${prefix}/${SSM_KEYS[key]}`;
}
