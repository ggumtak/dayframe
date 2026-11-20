import * as Crypto from 'expo-crypto';

/** Client-generated IDs let offline writes be retried without creating duplicates. */
export const uuid = (): string => Crypto.randomUUID();
