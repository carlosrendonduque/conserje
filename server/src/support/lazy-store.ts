/**
 * A Netlify Blobs handle that is not opened until it is used.
 *
 * `getStore()` throws outside a Netlify runtime, so calling it in a default
 * parameter makes the object impossible to construct anywhere else -- including
 * in the local dev server and in any test that only wanted the class. Deferring
 * the call moves that failure to the first actual read or write, which is the
 * only place it means anything.
 */

import { getStore, type Store } from '@netlify/blobs';

export type LazyStore = () => Store;

export function lazyStore(name: string): LazyStore {
  let opened: Store | undefined;

  return () => (opened ??= getStore(name));
}
