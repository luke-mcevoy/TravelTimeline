import { socialMock } from '../socialConfig';
import { mockSocialApi } from './mockApi';
import { realSupabaseApi } from './realApi';
import type { SocialApi } from './types';

export function getSocialApi(): SocialApi {
  return socialMock ? mockSocialApi : realSupabaseApi;
}

export { mockSocialApi, resetMockStore } from './mockApi';
export { getSupabaseClient, supabase } from './realApi';
