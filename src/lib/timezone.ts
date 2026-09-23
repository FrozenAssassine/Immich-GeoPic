import tzlookup from "@photostructure/tz-lookup";
import { parseGpxTime } from "./gpx";

/**
 * Returns the IANA timezone string for a given coordinate pair (lat, lng).
 * Example: (50.9693, 8.9672) -> "Europe/Berlin"
 */
export function getTimezoneForCoords(lat: number, lng: number): string | null {
  try {
    if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
      return null;
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

/**
 * Converts a local wall-clock date-time string (e.g. "2026-06-06 15:44:53" or "2026-06-06T15:44:53")
 * within a specific IANA timezone (e.g. "Europe/Berlin") to true UTC epoch milliseconds.
 */
export function parseLocalDateInTzToUtcMs(localDateTimeStr: string, timeZone: string): number {
  if (!localDateTimeStr) return 0;
  const trimmed = localDateTimeStr.trim();

  // Check if string already contains an explicit offset like +02:00 or -05:00
  if (/[+-]\d{2}:?\d{2}$/i.test(trimmed)) {
    return parseGpxTime(trimmed);
  }

  // Match YYYY-MM-DD HH:MM:SS or YYYY:MM:DD HH:MM:SS (EXIF format)
  const match = trimmed.match(/^(\d{4})[-:/](\d{2})[-:/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
  if (!match) {
    return Date.parse(trimmed) || 0;
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10) - 1;
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = parseInt(match[6], 10);
  const msStr = match[7] ? match[7].padEnd(3, "0").slice(0, 3) : "0";
  const millisecond = parseInt(msStr, 10);

  const guessUtc = Date.UTC(year, month, day, hour, minute, second, millisecond);

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    // If timezone is invalid, fallback to UTC or standard parse
    return guessUtc;
  }

  const getTzInstant = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const p: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== "literal") {
        p[part.type] = parseInt(part.value, 10);
      }
    }
    const hr = p.hour === 24 ? 0 : p.hour || 0;
    return Date.UTC(p.year, (p.month || 1) - 1, p.day || 1, hr, p.minute || 0, p.second || 0, millisecond);
  };

  // Handle offset strings directly like "+02:00" or "-05:00"
  if (timeZone.startsWith("+") || timeZone.startsWith("-")) {
    const rawDigits = localDateTimeStr.replace(/[Zz]$/, "").replace(/[+-]\d{2}:?\d{2}$/, "");
    return parseGpxTime(`${rawDigits}${timeZone}`);
  }

  const local1 = getTzInstant(guessUtc);
  const offset1 = local1 - guessUtc;
  const candidateUtc = guessUtc - offset1;

  // Refine for Daylight Saving Time boundaries
  const local2 = getTzInstant(candidateUtc);
  const offset2 = local2 - candidateUtc;
  return guessUtc - offset2;
}

export interface PhotoTimeParams {
  timestamp: string;
  coords?: { lat: number; lng: number };
  timeZone?: string | null;
  localDateTime?: string | null;
}

/**
 * Resolves the true UTC epoch milliseconds for a photo.
 * Requirements:
 * - "Assume the photos with existing gps data have a timestamp with the local time in the country
 *    they were taken if not otherwise specified in the metadata (newer exif data sometimes contains timezone information)."
 *
 * Logic:
 * 1. If timestamp string has an explicit offset (e.g. +02:00, -05:00):
 *    Parse directly with parseGpxTime.
 * 2. If explicit timezone metadata is provided (timeZone) e.g. from newer EXIF or Immich:
 *    - If timestamp already has trailing 'Z' (converted to UTC by Immich), parse as UTC directly to avoid double shifting.
 *    - Otherwise, convert local wall-clock time using the explicit timezone.
 * 3. If photo has GPS coords (lat, lng) and no timezone metadata:
 *    Lookup the timezone of the country/location, and convert the local wall-clock time to UTC.
 * 4. If photo is unreferenced (no GPS coords) and no timezone metadata:
 *    Use fallbackTimezone (from active GPX tracks or geotagged photos on the trip) to convert local wall-clock time to UTC.
 * 5. Default fallback to standard Date.parse.
 */
export function resolvePhotoTimeMs(photo: PhotoTimeParams, fallbackTimezone?: string | null): number {
  if (!photo.timestamp) return 0;
  const trimmed = photo.timestamp.trim();
  const raw = photo.localDateTime || photo.timestamp;

  // 1. Explicit offset directly in timestamp string (e.g. +02:00, -05:00)
  if (/[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    return parseGpxTime(trimmed);
  }

  // 2. Explicit timezone specified in metadata (newer EXIF)
  if (photo.timeZone && photo.timeZone.trim()) {
    const tz = photo.timeZone.trim();
    // If timestamp was already serialized in UTC ISO (ends with Z or z),
    // Immich has already converted it using the EXIF timezone offset.
    // Do NOT double shift!
    if (trimmed.endsWith("Z") || trimmed.endsWith("z")) {
      const t = Date.parse(trimmed);
      if (!Number.isNaN(t)) return t;
    }
    // If timestamp does not end with Z, convert local wall-clock time using the explicit timezone
    return parseLocalDateInTzToUtcMs(raw, tz);
  }

  // 3. Photo has GPS coordinates, but no timezone in metadata:
  // "Assume the photos with existing gps data have a timestamp with the local time in the country they were taken"
  if (photo.coords && typeof photo.coords.lat === "number" && typeof photo.coords.lng === "number") {
    const tz = getTimezoneForCoords(photo.coords.lat, photo.coords.lng);
    if (tz) {
      return parseLocalDateInTzToUtcMs(raw, tz);
    }
  }

  // 4. Unreferenced photo without GPS or timezone metadata:
  // Use fallback timezone if known from active GPX tracks or other trip photos
  if (fallbackTimezone) {
    return parseLocalDateInTzToUtcMs(raw, fallbackTimezone);
  }

  // Fallback to standard parse
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? 0 : parsed;
}
