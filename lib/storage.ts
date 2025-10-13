import { isClient } from "./utils";

const LOCAL_ID_KEY = "__specify_local_id";

function getLocalStorage(): Storage | undefined {
  try {
    if (isClient && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // LocalStorage might be disabled in some environments
    // continue without it in these cases
  }
  return undefined;
}

export function getLocalId(): string | null {
  const localStorage = getLocalStorage();
  if (localStorage) {
    return localStorage.getItem(LOCAL_ID_KEY);
  }
  return null;
}

export function setLocalId(localId: string): void {
  const localStorage = getLocalStorage();
  if (localStorage) {
    localStorage.setItem(LOCAL_ID_KEY, localId);
  }
}

export function removeLocalId(): void {
  const localStorage = getLocalStorage();
  if (localStorage) {
    localStorage.removeItem(LOCAL_ID_KEY);
  }
}
