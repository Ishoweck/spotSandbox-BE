// Shared read-time helper. Vendors saved with the old shape
// (selfDeliveryFee + selfDeliveryStates) are transparently translated to the
// new per-state pricing map so downstream code has one path.
export interface SelfDeliveryRow { state: string; fee: number }

export function readSelfDeliveryPricing(vendorProfile: any): SelfDeliveryRow[] {
  if (Array.isArray(vendorProfile?.selfDeliveryPricing) && vendorProfile.selfDeliveryPricing.length > 0) {
    return vendorProfile.selfDeliveryPricing
      .map((row: any) => ({
        state: String(row?.state || '').trim(),
        fee: Math.max(0, Number(row?.fee) || 0),
      }))
      .filter((row: SelfDeliveryRow) => !!row.state);
  }
  const legacyStates = Array.isArray(vendorProfile?.selfDeliveryStates) ? vendorProfile.selfDeliveryStates : [];
  const legacyFee = Math.max(0, Number(vendorProfile?.selfDeliveryFee) || 0);
  return legacyStates
    .map((s: any) => ({ state: String(s || '').trim(), fee: legacyFee }))
    .filter((row: SelfDeliveryRow) => !!row.state);
}

// Buyers type their state freely on the website: "Lagos State" and "lagos" must
// both match a "Lagos" row, and "Abuja" must match "FCT".
function normalizeState(state: string): string {
  const key = String(state || '').trim().toLowerCase().replace(/\s+state$/, '').trim();
  return ['abuja', 'fct abuja', 'abuja fct', 'federal capital territory'].includes(key) ? 'fct' : key;
}

export function findFeeForState(pricing: SelfDeliveryRow[], state: string): number | null {
  const key = normalizeState(state);
  if (!key) return null;
  const match = pricing.find((row) => normalizeState(row.state) === key);
  return match ? match.fee : null;
}
