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

