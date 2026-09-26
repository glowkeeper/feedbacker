/**
 * Remembers which folder is the workspace, and nothing else: the only thing
 * Feedbacker keeps in browser storage is this handle (ADR 0004). Records stay
 * in the folder, and deleting the workspace still means deleting the folder.
 */

const DB = "feedbacker";
const STORE = "handles";
const KEY = "workspace";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const rememberWorkspace = (handle: FileSystemDirectoryHandle) => transact("readwrite", (s) => s.put(handle, KEY)).then(() => {});
export const recallWorkspace = () => transact<FileSystemDirectoryHandle | undefined>("readonly", (s) => s.get(KEY)).then((h) => h ?? null);
export const forgetWorkspace = () => transact("readwrite", (s) => s.delete(KEY)).then(() => {});
