import type { Address } from "./types";
import { isClient } from "./utils";

const INDEXED_DB_NAME = "__specify_sdk_db";
const LOCAL_STORAGE_WALLET_ADDRESS_KEY = "__specify_addresses_cache";
const DB_VERSION = 1;
const STORE_NAME = "wallet-addresses";
const ADDRESSES_KEY = "addresses";

let dbPromise: Promise<IDBDatabase> | null = null;

// Fallback to localStorage if IndexedDB is not available or fails
function getLocalStorage(): Storage | undefined {
  try {
    if (isClient && window.localStorage) {
      return window.localStorage;
    }
  } catch (e) {
    // LocalStorage might be disabled in some environments
    console.warn("localStorage is not available:", e);
  }
  return undefined;
}

function initializeDB(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    if (!isClient || !window.indexedDB) {
      return reject("IndexedDB not supported");
    }

    const request = indexedDB.open(INDEXED_DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject(`IndexedDB error: ${((event.target as IDBOpenDBRequest).error as Error).message}`);
    };
  });

  return dbPromise;
}

async function getAddressesFromIndexedDB(): Promise<Address[] | null> {
  try {
    const db = await initializeDB();
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(ADDRESSES_KEY);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const entry = request.result;
        if (entry) {
          resolve(entry.addresses);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
  } catch (e) {
    console.warn("Failed to read from IndexedDB, falling back to localStorage:", e);
    return null; // Fallback will handle this
  }
}

async function saveAddressesToIndexedDB(addresses: Address[]): Promise<void> {
  try {
    const db = await initializeDB();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put({ addresses }, ADDRESSES_KEY);

    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error);
      };
    });
  } catch (e) {
    console.warn("Failed to write to IndexedDB, falling back to localStorage:", e);
    // If IndexedDB fails, we'll try localStorage via the public API
  }
}

export async function getStoredWalletAddresses(): Promise<Address[] | null> {
  // Try IndexedDB first
  const indexedDBAddresses = await getAddressesFromIndexedDB();
  if (indexedDBAddresses) {
    return indexedDBAddresses;
  }

  // Fallback to localStorage
  const localStorage = getLocalStorage();
  if (localStorage) {
    const addresses = localStorage.getItem(LOCAL_STORAGE_WALLET_ADDRESS_KEY);
    const parsed = addresses ? JSON.parse(addresses) : null;
    if (parsed) {
      return parsed.addresses;
    }
    return null;
  }

  return null;
}

export async function setStoredWalletAddresses(addresses: Address[]): Promise<void> {
  // Try IndexedDB first
  try {
    await saveAddressesToIndexedDB(addresses);
    return;
  } catch (e) {
    // IndexedDB failed, try localStorage
    console.warn("IndexedDB save failed, attempting localStorage fallback.");
  }

  const localStorage = getLocalStorage();
  if (localStorage) {
    localStorage.setItem(LOCAL_STORAGE_WALLET_ADDRESS_KEY, JSON.stringify({ addresses }));
  }
}
