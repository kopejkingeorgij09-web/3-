export function readStorage(key) {
  return (window.stormcoreNative?.storage ?? window.localStorage).getItem(key);
}

export function writeStorage(key,value) {
  (window.stormcoreNative?.storage ?? window.localStorage).setItem(key,value);
}
