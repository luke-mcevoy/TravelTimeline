import { openDB, type IDBPDatabase } from 'idb';
import type { Photo } from '@/types';

const DB_NAME = 'travel-timeline-photos';
const DB_VERSION = 1;
const PHOTO_STORE = 'photos';
const BLOB_STORE = 'blobs';
const THUMB_STORE = 'thumbnails';

interface PhotoDB {
  photos: { key: string; value: Photo };
  blobs: { key: string; value: Blob };
  thumbnails: { key: string; value: Blob };
}

let dbPromise: Promise<IDBPDatabase<PhotoDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<PhotoDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          db.createObjectStore(PHOTO_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE);
        }
        if (!db.objectStoreNames.contains(THUMB_STORE)) {
          db.createObjectStore(THUMB_STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function savePhoto(photo: Photo, blob: Blob, thumbnail: Blob): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PHOTO_STORE, BLOB_STORE, THUMB_STORE], 'readwrite');
  await Promise.all([
    tx.objectStore(PHOTO_STORE).put(photo),
    tx.objectStore(BLOB_STORE).put(blob, photo.id),
    tx.objectStore(THUMB_STORE).put(thumbnail, photo.id),
    tx.done,
  ]);
}

export async function getPhotosForDestination(destinationId: string): Promise<Photo[]> {
  const db = await getDb();
  const all = await db.getAll(PHOTO_STORE);
  return all.filter((p) => p.destinationId === destinationId);
}

export async function getPhotosForTrip(tripId: string): Promise<Photo[]> {
  const db = await getDb();
  const all = await db.getAll(PHOTO_STORE);
  return all.filter((p) => p.tripId === tripId);
}

export async function getAllPhotos(): Promise<Photo[]> {
  const db = await getDb();
  return db.getAll(PHOTO_STORE);
}

export async function getPhotoBlob(photoId: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get(BLOB_STORE, photoId);
}

export async function getThumbnailBlob(photoId: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get(THUMB_STORE, photoId);
}

export async function deletePhoto(photoId: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PHOTO_STORE, BLOB_STORE, THUMB_STORE], 'readwrite');
  await Promise.all([
    tx.objectStore(PHOTO_STORE).delete(photoId),
    tx.objectStore(BLOB_STORE).delete(photoId),
    tx.objectStore(THUMB_STORE).delete(photoId),
    tx.done,
  ]);
}

/** Wipes every stored photo, blob, and thumbnail. */
export async function clearAllPhotos(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction([PHOTO_STORE, BLOB_STORE, THUMB_STORE], 'readwrite');
  await Promise.all([
    tx.objectStore(PHOTO_STORE).clear(),
    tx.objectStore(BLOB_STORE).clear(),
    tx.objectStore(THUMB_STORE).clear(),
    tx.done,
  ]);
}
