import exifr from 'exifr';
import { nanoid } from 'nanoid';
import type { Photo, Destination } from '@/types';
import { haversineDistance } from './animation';

interface ExifData {
  DateTimeOriginal?: Date;
  CreateDate?: Date;
  GPSLatitude?: number;
  GPSLongitude?: number;
  latitude?: number;
  longitude?: number;
  ImageWidth?: number;
  ImageHeight?: number;
  ExifImageWidth?: number;
  ExifImageHeight?: number;
}

export interface ProcessedPhoto {
  photo: Photo;
  blob: Blob;
  thumbnail: Blob;
  objectUrl: string;
}

export async function processPhoto(
  file: File,
  tripId: string,
  destinations: Destination[]
): Promise<ProcessedPhoto> {
  const exif = await extractExif(file);
  const matched = matchDestination(exif, destinations);

  const photo: Photo = {
    id: nanoid(),
    destinationId: matched?.id || destinations[0]?.id || '',
    tripId,
    fileName: file.name,
    takenAt: exif.takenAt?.toISOString() || null,
    lat: exif.lat,
    lng: exif.lng,
    width: exif.width || 0,
    height: exif.height || 0,
  };

  const thumbnail = await createThumbnail(file, 300);
  const objectUrl = URL.createObjectURL(thumbnail);

  return { photo, blob: file, thumbnail, objectUrl };
}

async function extractExif(file: File): Promise<{
  takenAt: Date | null;
  lat: number | null;
  lng: number | null;
  width: number | null;
  height: number | null;
}> {
  try {
    const data: ExifData | null = await exifr.parse(file, {
      gps: true,
      pick: [
        'DateTimeOriginal',
        'CreateDate',
        'GPSLatitude',
        'GPSLongitude',
        'ImageWidth',
        'ImageHeight',
        'ExifImageWidth',
        'ExifImageHeight',
      ],
    });

    if (!data) {
      return { takenAt: null, lat: null, lng: null, width: null, height: null };
    }

    const takenAt = data.DateTimeOriginal || data.CreateDate || null;
    const lat = data.latitude ?? data.GPSLatitude ?? null;
    const lng = data.longitude ?? data.GPSLongitude ?? null;
    const width = data.ExifImageWidth || data.ImageWidth || null;
    const height = data.ExifImageHeight || data.ImageHeight || null;

    return { takenAt, lat, lng, width, height };
  } catch {
    return { takenAt: null, lat: null, lng: null, width: null, height: null };
  }
}

/**
 * Match a photo to the closest destination by GPS coordinates,
 * falling back to date matching if no GPS is available.
 */
function matchDestination(
  exif: { takenAt: Date | null; lat: number | null; lng: number | null },
  destinations: Destination[]
): Destination | null {
  if (destinations.length === 0) return null;

  // GPS-based matching
  if (exif.lat !== null && exif.lng !== null) {
    let closest = destinations[0];
    let minDist = Infinity;
    for (const dest of destinations) {
      const dist = haversineDistance(exif.lat, exif.lng, dest.lat, dest.lng);
      if (dist < minDist) {
        minDist = dist;
        closest = dest;
      }
    }
    return closest;
  }

  // Date-based matching
  if (exif.takenAt) {
    const photoTime = exif.takenAt.getTime();
    let best = destinations[0];
    let bestDiff = Infinity;
    for (const dest of destinations) {
      const arrTime = new Date(dest.arrivalDate).getTime();
      const depTime = new Date(dest.departureDate).getTime();
      if (photoTime >= arrTime && photoTime <= depTime) {
        return dest;
      }
      const diff = Math.min(
        Math.abs(photoTime - arrTime),
        Math.abs(photoTime - depTime)
      );
      if (diff < bestDiff) {
        bestDiff = diff;
        best = dest;
      }
    }
    return best;
  }

  return destinations[0];
}

function createThumbnail(file: File, maxSize: number): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let w = img.width;
      let h = img.height;
      if (w > h) {
        if (w > maxSize) {
          h = (h * maxSize) / w;
          w = maxSize;
        }
      } else {
        if (h > maxSize) {
          w = (w * maxSize) / h;
          h = maxSize;
        }
      }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => resolve(blob || new Blob()),
        'image/jpeg',
        0.8
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(new Blob());
    };
    img.src = url;
  });
}
