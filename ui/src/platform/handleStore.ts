/**
 * Remembers folders, and nothing else: the workspaces folder, chosen once,
 * and any workspace kept outside it. Folder handles are the only thing
 * Feedbacker keeps in browser storage (ADRs 0004 and 0008). Records stay in
 * the folders, and deleting a workspace still means deleting its folder.
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

/** The workspaces folder (ADR 0008), chosen once. */
const FOLDER_KEY = "workspaces-folder";
/** A workspace kept outside the workspaces folder, by its registration ID. */
const elsewhere = (registrationId: string) => `${KEY}:${registrationId}`;

const put = (key: string, handle: FileSystemDirectoryHandle) => transact("readwrite", (s) => s.put(handle, key)).then(() => {});
const get = (key: string) => transact<FileSystemDirectoryHandle | undefined>("readonly", (s) => s.get(key)).then((h) => h ?? null);
const drop = (key: string) => transact("readwrite", (s) => s.delete(key)).then(() => {});

export const rememberFolder = (handle: FileSystemDirectoryHandle) => put(FOLDER_KEY, handle);
export const recallFolder = () => get(FOLDER_KEY);
export const rememberElsewhere = (registrationId: string, handle: FileSystemDirectoryHandle) => put(elsewhere(registrationId), handle);
export const recallElsewhere = (registrationId: string) => get(elsewhere(registrationId));
/** Forget a deleted workspace's folder, if it was one kept elsewhere; and the folder chosen before this version, if any. */
export const forgetWorkspace = async (registrationId: string) => {
  await drop(elsewhere(registrationId));
  await drop(KEY);
};
