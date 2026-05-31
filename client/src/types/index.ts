export interface ServerPhotoRef {
  uuid: string;
  filename: string;
  directory: string;
  dateTaken: string;
  /** PhotoKit localIdentifier — present on the native (iOS) build only. */
  localIdentifier?: string;
}

export interface Destination {
  id: string;
  city: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  arrivalDate: string;
  departureDate: string;
  notes?: string;
  /** Photos from Apple Photos import, served via the server */
  serverPhotos?: ServerPhotoRef[];
  /** Direct image URL for the hero photo (used when viewing a friend's globe,
   *  where the hero is a remote thumbnail rather than a local PhotoKit ref). */
  heroUrl?: string;
}

export interface Trip {
  id: string;
  name: string;
  destinations: Destination[];
  createdAt: string;
  updatedAt: string;
}

export interface AnimationState {
  isPlaying: boolean;
  speed: number;
  currentTime: number;
  /** Index into the sorted global destination list */
  currentDestinationIndex: number;
  /** 0..1 progress between current and next destination */
  arcProgress: number;
}

export interface GlobeCamera {
  lat: number;
  lng: number;
  altitude: number;
}

export interface VideoExportSettings {
  width: number;
  height: number;
  fps: number;
  speed: number;
}

export interface Photo {
  id: string;
  destinationId: string;
  tripId: string;
  fileName: string;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  width: number;
  height: number;
}

export interface SortedDestination extends Destination {
  tripId: string;
  tripName: string;
}
