import type { DynoSession, Settings } from "../types";

const DB = "hpv-power-dyno", S = "sessions", T = "settings";

function open() {
  return new Promise<IDBDatabase>((ok, no) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(S, { keyPath: "id" });
      request.result.createObjectStore(T);
    };
    request.onsuccess = () => ok(request.result);
    request.onerror = () => no(request.error);
  });
}

function tx<A>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<A>) {
  return open().then((db) => new Promise<A>((ok, no) => {
    const request = run(db.transaction(store, mode).objectStore(store));
    request.onsuccess = () => ok(request.result);
    request.onerror = () => no(request.error);
  }));
}

async function saveUnique(session: DynoSession) {
  const db = await open();
  return new Promise<void>((ok, no) => {
    const transaction = db.transaction(S, "readwrite");
    const store = transaction.objectStore(S);
    transaction.oncomplete = () => ok();
    transaction.onerror = () => no(transaction.error);
    transaction.onabort = () => no(transaction.error);
    // Ogni prova ha un id proprio: un secondo salvataggio dello stesso risultato
    // aggiorna quella riga, mentre ogni nuovo sprint resta sempre nell'archivio.
    store.put(session);
  });
}

export const sessionRepo = {
  save: saveUnique,
  getAll: () => tx<DynoSession[]>(S, "readonly", (s) => s.getAll()),
  delete: (id: string) => tx(S, "readwrite", (s) => s.delete(id)),
  clear: () => tx(S, "readwrite", (s) => s.clear()),
  settings: async (defaults: Settings) => await tx<Settings | undefined>(T, "readonly", (s) => s.get("main")) ?? defaults,
  setSettings: (settings: Settings) => tx(T, "readwrite", (s) => s.put(settings, "main")),
};

export function download(name: string, text: string, type: string) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(new Blob([text], { type }));
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
