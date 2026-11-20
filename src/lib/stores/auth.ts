import { derived, writable } from 'svelte/store';
import { ipc, userMessage } from '$lib/api/arima';
import type { ScUser } from '$lib/types';

export type AuthStatus = 'checking' | 'anonymous' | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  user: ScUser | null;
  error: string | null;
  busy: boolean;
}

export const auth = writable<AuthState>({
  status: 'checking',
  user: null,
  error: null,
  busy: false
});

export const isAuthenticated = derived(auth, ($a) => $a.status === 'authenticated');

export async function restoreSession(): Promise<void> {
  try {
    const user = (await ipc.auth.restore()) as ScUser | null;
    auth.set(
      user
        ? { status: 'authenticated', user, error: null, busy: false }
        : { status: 'anonymous', user: null, error: null, busy: false }
    );
  } catch (e) {
    auth.set({ status: 'anonymous', user: null, error: userMessage(e), busy: false });
  }
}

export async function login(token: string): Promise<boolean> {
  auth.update((a) => ({ ...a, busy: true, error: null }));
  try {
    const user = (await ipc.auth.login(token)) as ScUser;
    auth.set({ status: 'authenticated', user, error: null, busy: false });
    return true;
  } catch (e) {
    auth.update((a) => ({ ...a, busy: false, error: userMessage(e) }));
    return false;
  }
}

export async function logout(): Promise<void> {
  await ipc.auth.logout().catch(() => undefined);
  auth.set({ status: 'anonymous', user: null, error: null, busy: false });
}
