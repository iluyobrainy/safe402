export const PROBE_PRICE_USD = 0.01;

export const AUDIT_PRICING_USD = {
  basic: 0.5,
  standard: 2.5,
  deep: 5
} as const;

export const AUDIT_MINIMUM_USD = 0.5;
export const AUDIT_REQUEST_VARIANT_USD = 0.25;
export const AUDIT_MCP_SERVER_SCAN_USD = 1;
export const AUDIT_HOSTED_REPORT_USD = 1;

export function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

export function calculateProbePrice(endpointCount: number): number {
  return PROBE_PRICE_USD * endpointCount;
}

export function calculateAuditProfilePrice(profile: keyof typeof AUDIT_PRICING_USD, endpointCount: number): number {
  return AUDIT_PRICING_USD[profile] * endpointCount;
}
