import type { OAuthProviderId } from "./oauth.js";
export type ModelProviderFamilyId = string;
export type ProviderFamilyDomain = ModelProviderFamilyId;
export interface ModelProviderFamilySpec {
  id: ModelProviderFamilyId;
  label: string;
  rootDomain: string;
  oauthProviderId: OAuthProviderId;
  startPlanProviderId: string;
  individualCodingPlanProviderId: string;
  teamCodingPlanProviderId: string;
}
// 原账号目录已移除；不能通过历史 ID 或端点恢复预置提供商。
export const MODEL_PROVIDER_FAMILY_SPECS: readonly ModelProviderFamilySpec[] = [];
export function getModelProviderFamilySpec(
  _familyId: ModelProviderFamilyId,
): ModelProviderFamilySpec {
  throw new Error("Account model integration has been removed");
}
export function resolveModelProviderFamilyIdByProviderId(
  _providerId: string,
): ModelProviderFamilyId | null {
  return null;
}
export function resolveModelProviderFamilyIdByBaseURL(
  _baseURL: string | null | undefined,
): ModelProviderFamilyId | null {
  return null;
}
export function resolveModelProviderFamilySpecByProviderId(
  _providerId: string,
): ModelProviderFamilySpec | null {
  return null;
}
export function resolveModelProviderFamilyLabelByProviderId(_providerId: string): string | null {
  return null;
}
export function normalizeProviderFamilyDomain(
  _value: string | null | undefined,
): ProviderFamilyDomain | null {
  return null;
}
export function resolveProviderFamilyDomainFromOAuthProvider(
  _provider: OAuthProviderId | string | null | undefined,
): ProviderFamilyDomain | null {
  return null;
}

export function shouldShowModelProviderFamilyForDomain(params: {
  familyId: ModelProviderFamilyId;
  providerFamilyDomain: ProviderFamilyDomain | null | undefined;
}): boolean {
  const providerFamilyDomain = normalizeProviderFamilyDomain(params.providerFamilyDomain);
  if (!providerFamilyDomain) {
    return true;
  }
  return params.familyId === providerFamilyDomain;
}

export function shouldShowModelProviderFamilyForActiveOAuth(params: {
  familyId: ModelProviderFamilyId;
  activeOAuthProvider: OAuthProviderId | null | undefined;
}): boolean {
  return shouldShowModelProviderFamilyForDomain({
    familyId: params.familyId,
    providerFamilyDomain: resolveProviderFamilyDomainFromOAuthProvider(params.activeOAuthProvider),
  });
}

export function shouldShowBuiltinModelProviderForDomain(params: {
  providerId: string;
  providerFamilyDomain: ProviderFamilyDomain | null | undefined;
}): boolean {
  const familyId = resolveModelProviderFamilyIdByProviderId(params.providerId);
  if (!familyId) {
    return true;
  }
  return shouldShowModelProviderFamilyForDomain({
    familyId,
    providerFamilyDomain: params.providerFamilyDomain,
  });
}

export function shouldShowBuiltinModelProviderForActiveOAuth(params: {
  providerId: string;
  activeOAuthProvider: OAuthProviderId | null | undefined;
}): boolean {
  return shouldShowBuiltinModelProviderForDomain({
    providerId: params.providerId,
    providerFamilyDomain: resolveProviderFamilyDomainFromOAuthProvider(params.activeOAuthProvider),
  });
}
