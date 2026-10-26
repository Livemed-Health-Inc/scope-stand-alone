const STORAGE_KEY = "virtualis.device.token";
const PREVIEW_KEY = "virtualis.device.preview";

export type DeviceContext = {
  device_id: string;
  hospital: string;
  unit: string;
  label: string;
};

export function getDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(PREVIEW_KEY) ?? window.localStorage.getItem(STORAGE_KEY);
}

export function setDeviceToken(token: string) {
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearDeviceToken() {
  window.localStorage.removeItem(STORAGE_KEY);
}

/** Session-scoped token used by admin bedside previews — never persisted. */
export function setPreviewToken(token: string) {
  window.sessionStorage.setItem(PREVIEW_KEY, token);
}

export function getPreviewToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(PREVIEW_KEY);
}

export function clearPreviewToken() {
  window.sessionStorage.removeItem(PREVIEW_KEY);
}

export function isPreviewSession(): boolean {
  return getPreviewToken() !== null;
}


const NURSE_KEY = "virtualis.nurse.session";
export type NurseSession = { session: string; nurseId: string; fullName: string; expiresAt: string };

/** Verified nurse at this tablet — tab-scoped, cleared on lock or sign-out. */
export function getNurseSession(): NurseSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(NURSE_KEY);
    const s = raw ? (JSON.parse(raw) as NurseSession) : null;
    if (s && new Date(s.expiresAt).getTime() <= Date.now()) {
      window.sessionStorage.removeItem(NURSE_KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function setNurseSession(s: NurseSession) {
  window.sessionStorage.setItem(NURSE_KEY, JSON.stringify(s));
}

export function clearNurseSession() {
  window.sessionStorage.removeItem(NURSE_KEY);
}
