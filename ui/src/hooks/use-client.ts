import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

export function useClientValue<T>(clientValue: () => T, serverValue: T): T {
  return useSyncExternalStore(emptySubscribe, clientValue, () => serverValue);
}
