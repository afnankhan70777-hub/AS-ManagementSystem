import { isCloudModeEnabled } from '../config/cloud';
import { fetchCloudUserLoginRecords } from '../lib/cloudData';
import { getSupabaseClient } from '../lib/supabase';
import { type DataRecord } from '../context/DataContext';
import { type CloudSnapshot } from '../lib/cloudData';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const CLOUD_SESSION_TOKENS_KEY = 'afroz-cloud-session-tokens';

export interface CloudUserInput {
  id?: string;
  username: string;
  fullName: string;
  email?: string;
  password?: string;
  organizationName?: string;
  role: string;
  status: string;
}

export interface CloudUsernameAvailability {
  available: boolean;
}

export interface CloudUserRightsPayload {
  username: string;
  data: Record<string, boolean>;
}

export async function bootstrapPlatformOwner() {
  await invokeManageUsers('bootstrap-platform-owner', {});
}

function readStoredCloudSessionTokens() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CLOUD_SESSION_TOKENS_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<{ accessToken: string; refreshToken: string }>;
    const accessToken = String(parsed?.accessToken || '').trim();
    const refreshToken = String(parsed?.refreshToken || '').trim();
    if (!accessToken || !refreshToken) {
      return null;
    }

    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

async function getManageUsersAccessToken() {
  const supabase = getSupabaseClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (sessionData.session?.access_token) {
    return sessionData.session.access_token;
  }

  const storedTokens = readStoredCloudSessionTokens();
  if (storedTokens) {
    const restoredSession = await supabase.auth.setSession({
      access_token: storedTokens.accessToken,
      refresh_token: storedTokens.refreshToken,
    });

    if (restoredSession.error) {
      throw restoredSession.error;
    }

    if (restoredSession.data.session?.access_token) {
      return restoredSession.data.session.access_token;
    }
  }

  const refreshedSession = await supabase.auth.refreshSession();
  if (refreshedSession.error) {
    throw refreshedSession.error;
  }

  if (refreshedSession.data.session?.access_token) {
    return refreshedSession.data.session.access_token;
  }

  throw new Error('No active cloud session is available. Please sign in again and retry.');
}

async function invokeManageUsers(action: string, payload: object) {
  if (!isCloudModeEnabled()) {
    throw new Error('Cloud user management is not enabled.');
  }

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration is incomplete.');
  }

  const supabase = getSupabaseClient();
  const accessToken = await getManageUsersAccessToken();

  const { data, error } = await supabase.functions.invoke('manage-users', {
    body: { action, ...payload },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
  });

  if (error) {
    const responseContext = error.context instanceof Response ? error.context : null;
    let responseMessage = '';

    if (responseContext) {
      try {
        const clonedResponse = responseContext.clone();
        const contentType = clonedResponse.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const responseBody = await clonedResponse.json() as { error?: string; message?: string };
          responseMessage = String(responseBody?.error || responseBody?.message || '').trim();
        } else {
          responseMessage = String(await clonedResponse.text()).trim();
        }
      } catch {
        responseMessage = '';
      }
    }

    const errorContext = !responseContext && typeof error.context === 'object' && error.context
      ? error.context as { status?: number; statusText?: string; error?: string; message?: string }
      : null;

    throw new Error(String(
      responseMessage
      || errorContext?.error
      || errorContext?.message
      || error.message
      || `User management failed${responseContext?.status ? ` (${responseContext.status})` : errorContext?.status ? ` (${errorContext.status})` : ''}`,
    ));
  }

  if ((data as any)?.error) {
    throw new Error(String((data as any).error));
  }

  return data;
}

export async function createCloudUser(input: CloudUserInput): Promise<DataRecord[]> {
  await invokeManageUsers('create-user', input);
  return fetchCloudUserLoginRecords();
}

export async function bootstrapCloudAdmin(input: CloudUserInput) {
  await invokeManageUsers('bootstrap-admin', input);
}

export async function checkCloudUsernameAvailability(username: string): Promise<CloudUsernameAvailability> {
  const data = await invokeManageUsers('check-username', { username });
  return {
    available: Boolean(data?.available),
  };
}

export async function updateCloudUser(input: CloudUserInput): Promise<DataRecord[]> {
  if (!input.id) {
    throw new Error('User id is required for updates.');
  }

  await invokeManageUsers('update-user', input);
  return fetchCloudUserLoginRecords();
}

export async function deleteCloudUser(id: string): Promise<DataRecord[]> {
  await invokeManageUsers('delete-user', { id });
  return fetchCloudUserLoginRecords();
}

export async function prepareCloudWorkspace(organizationName?: string, organizationId?: string, includeDemoData?: boolean) {
  await invokeManageUsers('prepare-workspace', {
    ...(organizationName ? { organizationName } : {}),
    ...(organizationId ? { organizationId } : {}),
    includeDemoData: includeDemoData ?? false,
  });
}

export async function clearCloudWorkspaceData(organizationId?: string, organizationName?: string, preserveUsers: boolean = true) {
  await invokeManageUsers('clear-workspace-data', {
    ...(organizationId ? { organizationId } : {}),
    ...(organizationName ? { organizationName } : {}),
    preserveUsers,
  });
}

export async function seedCloudLearningData(snapshot: CloudSnapshot, organizationId?: string) {
  for (const [collection, records] of Object.entries(snapshot)) {
    if (collection === 'user-logins' || !Array.isArray(records) || records.length === 0) {
      continue;
    }

    await invokeManageUsers('seed-learning-data', {
      ...(organizationId ? { organizationId } : {}),
      collection,
      records,
    });
  }
}

export async function fetchCloudUserRights(username: string): Promise<CloudUserRightsPayload | null> {
  const data = await invokeManageUsers('fetch-user-rights', { username });
  if (!data?.record) {
    return null;
  }

  return {
    username: String(data.record.username || username || '').trim(),
    data: ((data.record.data || {}) as Record<string, boolean>),
  };
}

export async function saveCloudUserRights(username: string, data: Record<string, boolean>): Promise<CloudUserRightsPayload> {
  const result = await invokeManageUsers('save-user-rights', { username, data });
  return {
    username: String(result?.record?.username || username || '').trim(),
    data: ((result?.record?.data || {}) as Record<string, boolean>),
  };
}
