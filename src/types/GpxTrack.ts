export type GpxTrackType = "file" | "url";

export interface GpxPoint {
  lat: number;
  lng: number;
  time: number; // UTC millisecond epoch
  ele?: number;
}

export interface GpxBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface GpxTrackMetadata {
  id: string;
  userId: string;
  type: GpxTrackType;
  name: string;
  filename?: string;
  url?: string;
  createdAt: string;
  fileSize?: number;
  pointsCount: number;
  startTime?: string;
  endTime?: string;
  bounds?: GpxBounds;
  isVisible: boolean;
  lastFetchedAt?: string;
  fetchError?: string;
}

export interface GpxTrackWithPoints extends GpxTrackMetadata {
  points: GpxPoint[];
}
