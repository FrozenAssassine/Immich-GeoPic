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
 * Logic:
 * 1. If explicit timezone is provided in metadata (timeZone): use it to convert local time to UTC.
 * 2. If timestamp string contains an explicit offset (e.g. +02:00 or -05:00): parse directly.
 * 3. If photo has GPS coords (lat, lng) and no timezone metadata:
 *    Lookup the timezone of the country/location, and assume timestamp represents local wall-clock time.
 * 4. If photo has no GPS coords (unreferenced):
 *    Use fallbackTimezone (from active GPX tracks or nearby geotagged photos) if available.
 */
export function resolvePhotoTimeMs(photo: PhotoTimeParams, fallbackTimezone?: string | null): number {
  if (!photo.timestamp) return 0;
  const raw = photo.localDateTime || photo.timestamp;

  // 1. Explicit timezone metadata in EXIF
  if (photo.timeZone && photo.timeZone.trim()) {
    const tz = photo.timeZone.trim();
    if (tz.startsWith("+") || tz.startsWith("-")) {
      return parseGpxTime(`${raw.replace(/[Zz]$/, "")}${tz}`);
    }
    return parseLocalDateInTzToUtcMs(raw, tz);
  }

  // 2. Explicit offset in timestamp string itself (e.g. +02:00, -04:00, or Z when not stripped)
  if (/[+-]\d{2}:?\d{2}$/.test(photo.timestamp.trim())) {
    return parseGpxTime(photo.timestamp);
  }

  // 3. Photo has GPS coordinates: lookup country timezone and interpret as local time
  if (photo.coords && typeof photo.coords.lat === "number" && typeof photo.coords.lng === "number") {
    const tz = getTimezoneForCoords(photo.coords.lat, photo.coords.lng);
    if (tz) {
      return parseLocalDateInTzToUtcMs(raw, tz);
    }
  }

  // 4. Unreferenced photo: use fallback timezone if known
  if (fallbackTimezone) {
    return parseLocalDateInTzToUtcMs(raw, fallbackTimezone);
  }

  // Fallback to standard parse
  const parsed = Date.parse(photo.timestamp);
  return Number.isNaN(parsed) ? 0 : parsed;
}
