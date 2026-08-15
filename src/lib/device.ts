const STORAGE_KEY = "virtualis.device.token";

export type DeviceContext = {
  device_id: string;
  hospital: string;
  unit: string;
  label: string;
};

export function getDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setDeviceToken(token: string) {
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearDeviceToken() {
  window.localStorage.removeItem(STORAGE_KEY);
}
