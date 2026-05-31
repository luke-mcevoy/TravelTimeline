import { registerPlugin } from '@capacitor/core';

export interface NativeAsset {
  /** PhotoKit localIdentifier — stable handle used to fetch the image later. */
  id: string;
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  dateTaken: number;
  isFavorite: boolean;
  width: number;
  height: number;
  /** Burst group id ('' when not part of a burst). */
  burstId: string;
  isScreenshot: boolean;
}

export type PhotoAccessStatus =
  | 'authorized'
  | 'limited'
  | 'denied'
  | 'restricted'
  | 'notDetermined';

export interface ReverseGeocodeResult {
  /** City / town, e.g. "Mykonos" ('' if unavailable). */
  locality: string;
  /** Neighbourhood / sub-locality ('' if unavailable). */
  subLocality: string;
  /** County / district ('' if unavailable). */
  subAdministrativeArea: string;
  /** State / region ('' if unavailable). */
  administrativeArea: string;
  /** ISO alpha-2 country code ('' if unavailable). */
  countryCode: string;
}

export interface PhotosPlugin {
  requestAccess(): Promise<{ status: PhotoAccessStatus }>;
  queryAssets(options: { yearsBack: number }): Promise<{ assets: NativeAsset[] }>;
  getThumbnail(options: { id: string; width: number }): Promise<{ dataUrl: string }>;
  reverseGeocode(options: {
    lat: number;
    lng: number;
  }): Promise<ReverseGeocodeResult>;
  /** Save a base64-encoded video into the device Photos library. */
  saveVideo(options: { data: string; ext?: string }): Promise<{ saved: boolean }>;
}

export const Photos = registerPlugin<PhotosPlugin>('Photos');
