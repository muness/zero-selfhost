type FeatureState = {
  total: number;
  remaining: number;
  unlimited: boolean;
  enabled: boolean;
  usage: number;
  nextResetAt: number | null;
  interval: string;
  included_usage: number;
};

const feature: FeatureState = {
  total: 0,
  remaining: 0,
  unlimited: true,
  enabled: true,
  usage: 0,
  nextResetAt: null,
  interval: '',
  included_usage: 0,
};

// Compatibility for existing consumers. This fork has no subscription service.
const unavailableBillingAction = async (..._args: unknown[]) => undefined;
export const useBilling = () => ({
  isLoading: false,
  customer: null,
  refetch: unavailableBillingAction,
  attach: unavailableBillingAction,
  track: unavailableBillingAction,
  openBillingPortal: unavailableBillingAction,
  isPro: true,
  chatMessages: feature,
  connections: feature,
  brainActivity: feature,
});
