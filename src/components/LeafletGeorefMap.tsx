'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng, LatLngBounds, LatLngExpression, LeafletMouseEvent } from "leaflet";
import styles from "./LeafletGeorefMap.module.scss";
import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility";
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css";
import {
  MapContainer,
  useMapEvents,
  TileLayer,
  CircleMarker,
  Polyline,
  Rectangle,
  useMap,
  Tooltip,
} from "react-leaflet";
import { ImageItem } from "@/types/ImageItem";
import { GpxPoint, GpxTrackMetadata, GpxTrackWithPoints } from "@/types/GpxTrack";
import { getTimezoneForCoords, resolvePhotoTimeMs } from "@/lib/timezone";
import L from "leaflet";
import {
  X,
  MapPin,
  Calendar,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Maximize2,
  BoxSelect,
  Trash2,
  CheckCheck,
  Compass,
  Layers,
  Route,
  UploadCloud,
} from "lucide-react";
import { BaseMap, BaseMapPreset, DEFAULT_BASEMAP, BASEMAP_PRESETS } from "@/types/BaseMap";
import BaseMapModal from "@/components/BaseMapModal";

type Props = {
  images: ImageItem[];
  onImagesUpdate?: (images: ImageItem[]) => void;
  center?: LatLngExpression;
  zoom?: number;
  sessionToken?: string | null;
  zoomCategoryTarget?: {
    category: "all" | "geotagged" | "unreferenced";
    timestamp: number;
  } | null;
};

type EstimatedImageItem = ImageItem & {
  estimated?: boolean;
  estCoords?: { lat: number; lng: number };
  resolvedTime?: number;
};

function parseTimeMs(timestamp: string): number {
  const t = Date.parse(timestamp);
  return Number.isNaN(t) ? 0 : t;
}

function interpolate(a: number, b: number, ratio: number): number {
  return a + (b - a) * ratio;
}

function interpolateCoords(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  ratio: number
) {
  return {
    lat: interpolate(a.lat, b.lat, ratio),
    lng: interpolate(a.lng, b.lng, ratio),
  };
}

function hasValidCoords(img: ImageItem): boolean {
  return (
    !!img.coords &&
    typeof img.coords.lat === "number" &&
    typeof img.coords.lng === "number" &&
    !Number.isNaN(img.coords.lat) &&
    !Number.isNaN(img.coords.lng)
  );
}

function deterministicOffset(id: string, salt: number, scale = 0.001): number {
  let hash = salt;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0;
  }
  const normalized = ((Math.abs(hash) % 10000) / 10000) - 0.5;
  return normalized * scale;
}

function computeEstimatedPositions(
  items: ImageItem[],
  gpxPoints: GpxPoint[] = []
): EstimatedImageItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  // Determine timezone from GPX points if present, or from geotagged photos
  let inferredTz: string | null = null;
  if (gpxPoints.length > 0) {
    inferredTz = getTimezoneForCoords(gpxPoints[0].lat, gpxPoints[0].lng);
  }
  if (!inferredTz) {
    const geoItem = items.find(hasValidCoords);
    if (geoItem?.coords) {
      inferredTz = getTimezoneForCoords(geoItem.coords.lat, geoItem.coords.lng);
    }
  }

  // Create clean shallow clones with resolved UTC times
  const out: (EstimatedImageItem & { resolvedTime: number })[] = items
    .map((item) => {
      const { estimated, estCoords, ...cleanItem } = item as EstimatedImageItem;
      const resolvedTime = resolvePhotoTimeMs(cleanItem, inferredTz);
      return {
        ...cleanItem,
        resolvedTime,
        estimated: false,
        estCoords: undefined,
      };
    })
    .sort((a, b) => a.resolvedTime - b.resolvedTime);

  // Combine verified photos and GPX points into a unified sorted reference list
  interface RefPoint {
    lat: number;
    lng: number;
    time: number;
  }

  const refPoints: RefPoint[] = [];

  for (const item of out) {
    if (hasValidCoords(item)) {
      refPoints.push({
        lat: item.coords!.lat,
        lng: item.coords!.lng,
        time: item.resolvedTime,
      });
    }
  }

  for (const pt of gpxPoints) {
    refPoints.push({
      lat: pt.lat,
      lng: pt.lng,
      time: pt.time,
    });
  }

  refPoints.sort((a, b) => a.time - b.time);

  // Binary search helper to find enclosing reference points for a given timestamp
  const findEnclosingRefPoints = (time: number) => {
    let low = 0;
    let high = refPoints.length - 1;
    let prevIdx = -1;
    let nextIdx = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (refPoints[mid].time === time) {
        return { prev: refPoints[mid], next: refPoints[mid] };
      } else if (refPoints[mid].time < time) {
        prevIdx = mid;
        low = mid + 1;
      } else {
        nextIdx = mid;
        high = mid - 1;
      }
    }

    return {
      prev: prevIdx !== -1 ? refPoints[prevIdx] : undefined,
      next: nextIdx !== -1 ? refPoints[nextIdx] : undefined,
    };
  };

  // Estimate unlocated photos
  for (let i = 0; i < out.length; i++) {
    if (hasValidCoords(out[i])) {
      out[i].estimated = false;
      out[i].estCoords = undefined;
      continue;
    }

    if (refPoints.length === 0) {
      out[i].estimated = true;
      out[i].estCoords = {
        lat: 51.5074 + deterministicOffset(out[i].id, 5, 0.05),
        lng: -0.1278 + deterministicOffset(out[i].id, 6, 0.05),
      };
      continue;
    }

    const { prev, next } = findEnclosingRefPoints(out[i].resolvedTime);

    if (prev && next) {
      const diff = next.time - prev.time;
      const ratio = diff > 0 ? (out[i].resolvedTime - prev.time) / diff : 0.5;
      const est = interpolateCoords(prev, next, ratio);
      out[i].estimated = true;
      out[i].estCoords = { lat: est.lat, lng: est.lng };
    } else if (prev) {
      out[i].estimated = true;
      out[i].estCoords = {
        lat: prev.lat + deterministicOffset(out[i].id, 1),
        lng: prev.lng + deterministicOffset(out[i].id, 2),
      };
    } else if (next) {
      out[i].estimated = true;
      out[i].estCoords = {
        lat: next.lat + deterministicOffset(out[i].id, 3),
        lng: next.lng + deterministicOffset(out[i].id, 4),
      };
    } else {
      out[i].estimated = true;
      out[i].estCoords = {
        lat: 51.5074 + deterministicOffset(out[i].id, 5, 0.05),
        lng: -0.1278 + deterministicOffset(out[i].id, 6, 0.05),
      };
    }
  }

  return out;
}

interface CameraControllerProps {
  trigger: number;
  coords: [number, number][];
  zoomCategoryTarget?: {
    category: "all" | "geotagged" | "unreferenced";
    timestamp: number;
  } | null;
  computedImages: EstimatedImageItem[];
  flyToBoundsTarget?: LatLngBounds | null;
  onClearFlyTarget?: () => void;
}

function CameraController({
  trigger,
  coords,
  zoomCategoryTarget,
  computedImages,
  flyToBoundsTarget,
  onClearFlyTarget,
}: CameraControllerProps) {
  const map = useMap();
  const prevTriggerRef = useRef(0);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const prevCategoryTargetRef = useRef<number>(0);

  // Handle explicit fly to bounds target (e.g. from GPX track zoom)
  useEffect(() => {
    if (!flyToBoundsTarget) return;
    map.invalidateSize();
    map.flyToBounds(flyToBoundsTarget, {
      padding: [60, 60],
      maxZoom: 16,
      duration: 1.0,
    });
    if (onClearFlyTarget) onClearFlyTarget();
  }, [flyToBoundsTarget, map, onClearFlyTarget]);

  useEffect(() => {
    // Only fit bounds if trigger was explicitly incremented and changed
    if (trigger === 0 || trigger === prevTriggerRef.current) return;
    prevTriggerRef.current = trigger;

    const timer = setTimeout(() => {
      map.invalidateSize();
      const currentCoords = coordsRef.current;
      if (currentCoords.length > 0) {
        const b = L.latLngBounds(currentCoords);
        map.fitBounds(b, { padding: [60, 60], maxZoom: 16 });
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [trigger, map]);

  // Handle category-specific zoom (All, Geotagged, Unreferenced)
  useEffect(() => {
    if (
      !zoomCategoryTarget ||
      zoomCategoryTarget.timestamp === prevCategoryTargetRef.current
    ) {
      return;
    }
    prevCategoryTargetRef.current = zoomCategoryTarget.timestamp;

    const { category } = zoomCategoryTarget;
    const targetCoords: [number, number][] = [];

    if (category === "all") {
      for (const img of computedImages) {
        const c = img.coords || img.estCoords;
        if (c && !Number.isNaN(c.lat) && !Number.isNaN(c.lng)) {
          targetCoords.push([c.lat, c.lng]);
        }
      }
    } else if (category === "geotagged") {
      for (const img of computedImages) {
        if (
          img.coords &&
          !Number.isNaN(img.coords.lat) &&
          !Number.isNaN(img.coords.lng)
        ) {
          targetCoords.push([img.coords.lat, img.coords.lng]);
        }
      }
    } else if (category === "unreferenced") {
      for (const img of computedImages) {
        if (
          !img.coords &&
          img.estCoords &&
          !Number.isNaN(img.estCoords.lat) &&
          !Number.isNaN(img.estCoords.lng)
        ) {
          targetCoords.push([img.estCoords.lat, img.estCoords.lng]);
        }
      }
    }

    if (targetCoords.length === 0) return;

    map.invalidateSize();
    if (targetCoords.length === 1) {
      map.flyTo(targetCoords[0], Math.min(map.getZoom() || 14, 16), {
        duration: 0.8,
      });
    } else {
      const bounds = L.latLngBounds(targetCoords);
      map.flyToBounds(bounds, {
        padding: [60, 60],
        maxZoom: 16,
        duration: 0.8,
      });
    }
  }, [zoomCategoryTarget, computedImages, map]);

  return null;
}

interface RectangleDrawerProps {
  boxSelectMode: boolean;
  isRelocating: boolean;
  setIsRelocating: (val: boolean) => void;
  bounds: LatLngBounds | null;
  setBounds: (bounds: LatLngBounds | null) => void;
  onMapClick: (e: LeafletMouseEvent) => void;
}

function RectangleDrawer({
  boxSelectMode,
  isRelocating,
  setIsRelocating,
  bounds,
  setBounds,
  onMapClick,
}: RectangleDrawerProps) {
  const map = useMap();
  const isDrawingRef = useRef(false);
  const startLatLngRef = useRef<LatLng | null>(null);
  const drawBoundsRef = useRef<LatLngBounds | null>(null);
  const [drawBounds, setDrawBounds] = useState<LatLngBounds | null>(null);
  const shiftPressed = useRef(false);

  const boxSelectModeRef = useRef(boxSelectMode);
  boxSelectModeRef.current = boxSelectMode;

  const isRelocatingRef = useRef(isRelocating);
  isRelocatingRef.current = isRelocating;

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  const setBoundsRef = useRef(setBounds);
  setBoundsRef.current = setBounds;

  const setIsRelocatingRef = useRef(setIsRelocating);
  setIsRelocatingRef.current = setIsRelocating;

  // Disable map panning when boxSelectMode is active
  useEffect(() => {
    if (boxSelectMode) {
      map.dragging.disable();
    } else if (!shiftPressed.current && !isDrawingRef.current) {
      map.dragging.enable();
    }
  }, [boxSelectMode, map]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftPressed.current = true;
        map.dragging.disable();
      }
      if (e.key === "Escape") {
        setIsRelocatingRef.current(false);
        setBoundsRef.current(null);
        setDrawBounds(null);
        drawBoundsRef.current = null;
        isDrawingRef.current = false;
        startLatLngRef.current = null;
        if (!boxSelectModeRef.current) {
          map.dragging.enable();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shiftPressed.current = false;
        if (!boxSelectModeRef.current && !isDrawingRef.current) {
          map.dragging.enable();
        }
      }
    };

    const handleGlobalMouseUp = () => {
      if (isDrawingRef.current) {
        if (drawBoundsRef.current) {
          setBoundsRef.current(drawBoundsRef.current);
        }
        isDrawingRef.current = false;
        startLatLngRef.current = null;
        drawBoundsRef.current = null;
        setDrawBounds(null);
        if (!boxSelectModeRef.current && !shiftPressed.current) {
          map.dragging.enable();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mouseup", handleGlobalMouseUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
  }, [map]);

  useMapEvents({
    mousedown(e) {
      if (isRelocatingRef.current) return;
      if (shiftPressed.current || boxSelectModeRef.current) {
        isDrawingRef.current = true;
        startLatLngRef.current = e.latlng;
        drawBoundsRef.current = null;
        map.dragging.disable();
        setBoundsRef.current(null);
        setDrawBounds(null);
      }
    },
    mousemove(e) {
      if (isDrawingRef.current && startLatLngRef.current) {
        const currentBounds = L.latLngBounds(startLatLngRef.current, e.latlng);
        drawBoundsRef.current = currentBounds;
        setDrawBounds(currentBounds);
      }
    },
    mouseup(e) {
      if (isDrawingRef.current && startLatLngRef.current) {
        const startPt = map.latLngToContainerPoint(startLatLngRef.current);
        const endPt = map.latLngToContainerPoint(e.latlng);
        const dist = startPt.distanceTo(endPt);

        // Only create selection if user dragged at least 15 pixels
        if (dist >= 15) {
          const finalBounds = L.latLngBounds(startLatLngRef.current, e.latlng);
          setBoundsRef.current(finalBounds);
        } else {
          setBoundsRef.current(null);
        }

        isDrawingRef.current = false;
        startLatLngRef.current = null;
        drawBoundsRef.current = null;
        setDrawBounds(null);

        if (!boxSelectModeRef.current && !shiftPressed.current) {
          map.dragging.enable();
        }
      }
    },
    click(e) {
      onMapClickRef.current(e);
    },
  });

  const activeBounds = drawBounds || bounds;

  return activeBounds ? (
    <Rectangle
      bounds={activeBounds}
      pathOptions={{
        color: "#4250af",
        weight: 2,
        fillColor: "#4250af",
        fillOpacity: 0.15,
        dashArray: "6, 6",
      }}
    />
  ) : null;
}

export default function LeafletGeorefMap(props: Props) {
  const [images, setImages] = useState<ImageItem[]>(props.images);
  const [selectedImage, setSelectedImage] = useState<EstimatedImageItem | null>(null);
  const [isRelocating, setIsRelocating] = useState(false);
  const [boxSelectMode, setBoxSelectMode] = useState(false);
  const [bounds, setBounds] = useState<LatLngBounds | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // GPX Track state
  const [gpxTracks, setGpxTracks] = useState<GpxTrackMetadata[]>([]);
  const [visibleGpxTracks, setVisibleGpxTracks] = useState<GpxTrackWithPoints[]>([]);
  const [isDraggingGpx, setIsDraggingGpx] = useState(false);
  const [activeModalTab, setActiveModalTab] = useState<"basemaps" | "gpx">("basemaps");
  const [flyToBoundsTarget, setFlyToBoundsTarget] = useState<LatLngBounds | null>(null);
  const gpxFileInputRef = useRef<HTMLInputElement>(null);

  // Sync state if props change from outside
  useEffect(() => {
    setImages(props.images);
  }, [props.images]);

  // Notify parent of state updates
  const updateImages = (newImages: ImageItem[]) => {
    setImages(newImages);
    props.onImagesUpdate?.(newImages);
  };

  const allVisibleGpxPoints = useMemo(() => {
    const pts: GpxPoint[] = [];
    for (const t of visibleGpxTracks) {
      if (t.points && t.points.length > 0) {
        pts.push(...t.points);
      }
    }
    return pts;
  }, [visibleGpxTracks]);

  const computed = useMemo(() => {
    return computeEstimatedPositions(images, allVisibleGpxPoints);
  }, [images, allVisibleGpxPoints]);

  // Keep selected image in sync with computed list
  useEffect(() => {
    if (selectedImage) {
      const refreshed = computed.find((img) => img.id === selectedImage.id);
      if (refreshed) {
        setSelectedImage(refreshed);
      }
    }
  }, [computed]);

  const initialCenter: LatLngExpression = useMemo(() => {
    if (props.center) return props.center;
    const firstWithCoords = computed.find((i) => i.coords || i.estCoords);
    if (firstWithCoords?.coords) {
      return [firstWithCoords.coords.lat, firstWithCoords.coords.lng];
    }
    if (firstWithCoords?.estCoords) {
      return [firstWithCoords.estCoords.lat, firstWithCoords.estCoords.lng];
    }
    if (allVisibleGpxPoints.length > 0) {
      return [allVisibleGpxPoints[0].lat, allVisibleGpxPoints[0].lng];
    }
    return [51.5074, -0.1278]; // Default London
  }, [computed, allVisibleGpxPoints, props.center]);

  // Dotted route segments connecting verified photos and all visible GPX trackpoints
  const georefSegments: [number, number][][] = useMemo(() => {
    interface RefPt {
      lat: number;
      lng: number;
      time: number;
    }
    const points: RefPt[] = [];

    let tz: string | null = null;
    if (allVisibleGpxPoints.length > 0) {
      tz = getTimezoneForCoords(allVisibleGpxPoints[0].lat, allVisibleGpxPoints[0].lng);
    }
    if (!tz) {
      const geo = computed.find(hasValidCoords);
      if (geo?.coords) {
        tz = getTimezoneForCoords(geo.coords.lat, geo.coords.lng);
      }
    }

    for (const item of computed) {
      if (hasValidCoords(item)) {
        points.push({
          lat: item.coords!.lat,
          lng: item.coords!.lng,
          time: resolvePhotoTimeMs(item, tz),
        });
      }
    }

    for (const pt of allVisibleGpxPoints) {
      points.push({
        lat: pt.lat,
        lng: pt.lng,
        time: pt.time,
      });
    }

    if (points.length < 2) return [];

    points.sort((a, b) => a.time - b.time);

    const segments: [number, number][][] = [];
    let currentSeg: [number, number][] = [];
    const MAX_GAP_MS = 6 * 3600 * 1000; // 6 hours

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (currentSeg.length > 0) {
        const prev = points[i - 1];
        if (pt.time - prev.time > MAX_GAP_MS) {
          if (currentSeg.length >= 2) {
            segments.push(currentSeg);
          }
          currentSeg = [];
        }
      }
      currentSeg.push([pt.lat, pt.lng]);
    }

    if (currentSeg.length >= 2) {
      segments.push(currentSeg);
    }

    return segments;
  }, [computed, allVisibleGpxPoints]);

  // Filter items within selection rectangle
  const selectedItemsInBounds = useMemo(() => {
    if (!bounds) return [];
    return computed.filter((i) => {
      const c = i.coords || i.estCoords;
      if (!c || Number.isNaN(c.lat) || Number.isNaN(c.lng)) return false;
      return bounds.contains([c.lat, c.lng]);
    });
  }, [bounds, computed]);

  const estimatedInBounds = useMemo(() => {
    return selectedItemsInBounds.filter(
      (i) => !hasValidCoords(i) && i.estimated && i.estCoords
    );
  }, [selectedItemsInBounds]);

  const getAuthHeaders = () => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    const token =
      props.sessionToken ||
      (typeof window !== "undefined"
        ? localStorage.getItem("geopic_session_token")
        : null);
    if (token) {
      h["Authorization"] = `Bearer ${token}`;
    }
    return h;
  };

  const [baseMaps, setBaseMaps] = useState<BaseMap[]>([DEFAULT_BASEMAP]);
  const [selectedBaseMapId, setSelectedBaseMapId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("geopic_active_basemap") || DEFAULT_BASEMAP.id;
    }
    return DEFAULT_BASEMAP.id;
  });
  const [presets, setPresets] = useState<BaseMapPreset[]>(BASEMAP_PRESETS);
  const [showBaseMapModal, setShowBaseMapModal] = useState(false);

  useEffect(() => {
    let isMounted = true;
    async function loadBaseMaps() {
      try {
        const res = await fetch("/api/settings/basemaps", {
          headers: getAuthHeaders(),
        });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            if (Array.isArray(data.baseMaps) && data.baseMaps.length > 0) {
              setBaseMaps(data.baseMaps);
            }
            if (data.selectedId) {
              setSelectedBaseMapId(data.selectedId);
              if (typeof window !== "undefined") {
                localStorage.setItem("geopic_active_basemap", data.selectedId);
              }
            }
            if (Array.isArray(data.presets)) {
              setPresets(data.presets);
            }
          }
        }
      } catch (err) {
        console.error("Failed to load base maps:", err);
      }
    }
    loadBaseMaps();
    return () => {
      isMounted = false;
    };
  }, [props.sessionToken]);

  const activeBaseMap = useMemo(() => {
    return (
      baseMaps.find((b) => b.id === selectedBaseMapId) ||
      baseMaps[0] ||
      DEFAULT_BASEMAP
    );
  }, [baseMaps, selectedBaseMapId]);

  const handleSelectBaseMap = async (id: string) => {
    setSelectedBaseMapId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem("geopic_active_basemap", id);
    }
    try {
      await fetch("/api/settings/basemaps", {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ selectedId: id }),
      });
    } catch (err) {
      console.error("Failed to persist selected base map:", err);
    }
  };

  const handleAddBaseMap = async (newMap: Omit<BaseMap, "id" | "isDefault">) => {
    const res = await fetch("/api/settings/basemaps", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify(newMap),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to add base map");
    }
    const data = await res.json();
    setBaseMaps(data.baseMaps);
    if (data.selectedId) {
      setSelectedBaseMapId(data.selectedId);
      if (typeof window !== "undefined") {
        localStorage.setItem("geopic_active_basemap", data.selectedId);
      }
    }
  };

  const handleDeleteBaseMap = async (id: string) => {
    const res = await fetch(`/api/settings/basemaps?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || "Failed to delete base map");
    }
    const data = await res.json();
    setBaseMaps(data.baseMaps);
    if (data.selectedId) {
      setSelectedBaseMapId(data.selectedId);
      if (typeof window !== "undefined") {
        localStorage.setItem("geopic_active_basemap", data.selectedId);
      }
    }
  };

  // GPX Track loaders and management handlers
  const loadGpxTracks = React.useCallback(async () => {
    try {
      // 1. Fetch visible tracks with points for path interpolation and dotted line
      const ptsRes = await fetch("/api/gpx?includePoints=true&visibleOnly=true", {
        headers: getAuthHeaders(),
      });
      if (ptsRes.ok) {
        const data = await ptsRes.json();
        setVisibleGpxTracks(data.tracks || []);
      }

      // 2. Fetch full metadata list for layer dialog
      const metaRes = await fetch("/api/gpx", {
        headers: getAuthHeaders(),
      });
      if (metaRes.ok) {
        const data = await metaRes.json();
        setGpxTracks(data.tracks || []);
      }
    } catch (err) {
      console.error("Failed to load GPX tracks:", err);
    }
  }, [props.sessionToken]);

  useEffect(() => {
    loadGpxTracks();
  }, [loadGpxTracks]);

  const handleUploadGpxFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    const token =
      props.sessionToken ||
      (typeof window !== "undefined"
        ? localStorage.getItem("geopic_session_token")
        : null);
    const headers: Record<string, string> = {};
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch("/api/gpx", {
      method: "POST",
      headers,
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to upload GPX file");
    }

    await loadGpxTracks();
  };

  const handleAddGpxUrl = async (url: string, name?: string) => {
    const res = await fetch("/api/gpx", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ url, name }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to add GPX URL");
    }

    await loadGpxTracks();
  };

  const handleToggleGpxVisibility = async (id: string, isVisible: boolean) => {
    setGpxTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isVisible } : t))
    );

    const res = await fetch("/api/gpx", {
      method: "PATCH",
      headers: getAuthHeaders(),
      body: JSON.stringify({ id, isVisible }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to update track visibility");
    }

    await loadGpxTracks();
  };

  const handleDeleteGpxTrack = async (id: string) => {
    const res = await fetch(`/api/gpx?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: getAuthHeaders(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to delete GPX track");
    }

    await loadGpxTracks();
  };

  const handleZoomToGpxTrack = (track: GpxTrackMetadata) => {
    if (track.bounds) {
      setShowBaseMapModal(false);
      const b = L.latLngBounds([
        [track.bounds.minLat, track.bounds.minLng],
        [track.bounds.maxLat, track.bounds.maxLng],
      ]);
      setFlyToBoundsTarget(b);
    }
  };

  const handleMapDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingGpx(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.name.toLowerCase().endsWith(".gpx")) {
          await handleUploadGpxFile(file);
        }
      }
    }
  };

  const handleQuickFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        await handleUploadGpxFile(file);
      } catch (err) {
        console.error("Quick GPX upload failed:", err);
      } finally {
        if (gpxFileInputRef.current) {
          gpxFileInputRef.current.value = "";
        }
      }
    }
  };

  // Single marker relocation click
  const handleMapClick = async (e: LeafletMouseEvent) => {
    if (!isRelocating || !selectedImage) return;

    const { lat, lng } = e.latlng;
    setIsRelocating(false);
    setIsUpdating(true);

    try {
      const res = await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords: { lat, lng } }),
      });
      if (!res.ok) {
        throw new Error(`Failed to relocate marker: ${res.status}`);
      }

      const updated = images.map((img) => {
        if (img.id === selectedImage.id) {
          const { estimated, estCoords, ...clean } = img as EstimatedImageItem;
          return { ...clean, coords: { lat, lng } };
        }
        return img;
      });
      updateImages(updated);
    } catch (err) {
      console.error("Failed to relocate marker:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Fix single estimated marker
  const handleFixSingleMarker = async () => {
    if (!selectedImage?.estCoords) return;

    setIsUpdating(true);
    try {
      const coords = selectedImage.estCoords;
      const res = await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords }),
      });
      if (!res.ok) {
        throw new Error(`Failed to fix marker: ${res.status}`);
      }

      const updated = images.map((img) => {
        if (img.id === selectedImage.id) {
          const { estimated, estCoords, ...clean } = img as EstimatedImageItem;
          return { ...clean, coords };
        }
        return img;
      });
      updateImages(updated);
    } catch (err) {
      console.error("Failed to fix marker:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Remove coordinates for single marker
  const handleRemoveCoordinates = async () => {
    if (!selectedImage) return;

    setIsUpdating(true);
    try {
      const res = await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords: null }),
      });
      if (!res.ok) {
        throw new Error(`Failed to remove coordinates: ${res.status}`);
      }

      const updated = images.map((img) => {
        if (img.id === selectedImage.id) {
          const { estimated, estCoords, ...clean } = img as EstimatedImageItem;
          return { ...clean, coords: undefined };
        }
        return img;
      });
      updateImages(updated);
    } catch (err) {
      console.error("Failed to remove coordinates:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Fix batch of markers inside rectangle selection
  const handleFixBatchMarkers = async () => {
    if (estimatedInBounds.length === 0) return;

    setIsUpdating(true);
    try {
      const updates = estimatedInBounds.map((img) => ({
        id: img.id,
        coords: img.estCoords!,
      }));

      const res = await fetch("/api/images/bulk-location", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        throw new Error(`Failed to bulk fix markers: ${res.status}`);
      }

      const updatedMap = new Map(updates.map((u) => [u.id, u.coords]));
      const updated = images.map((img) => {
        const newCoords = updatedMap.get(img.id);
        if (newCoords) {
          const { estimated, estCoords, ...clean } = img as EstimatedImageItem;
          return { ...clean, coords: newCoords };
        }
        return img;
      });

      updateImages(updated);
      setBounds(null);
    } catch (err) {
      console.error("Failed to bulk fix markers:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  const hasAutoFittedRef = useRef(false);
  const [fitTrigger, setFitTrigger] = useState(0);

  useEffect(() => {
    if (images.length > 0 && !hasAutoFittedRef.current) {
      hasAutoFittedRef.current = true;
      setFitTrigger((prev) => prev + 1);
    } else if (images.length === 0) {
      hasAutoFittedRef.current = false;
    }
  }, [images]);

  const allCoords = useMemo(() => {
    const coords: [number, number][] = [];
    for (let i = 0; i < computed.length; i++) {
      const c = computed[i].coords || computed[i].estCoords;
      if (c && !Number.isNaN(c.lat) && !Number.isNaN(c.lng)) {
        coords.push([c.lat, c.lng]);
      }
    }
    // Also include sampled points from active GPX tracks
    for (let i = 0; i < allVisibleGpxPoints.length; i += 10) {
      coords.push([allVisibleGpxPoints[i].lat, allVisibleGpxPoints[i].lng]);
    }
    return coords;
  }, [computed, allVisibleGpxPoints]);

  return (
    <div
      className={`${styles.mapWrapper} ${isRelocating ? styles.relocateActive : ""} ${
        boxSelectMode ? styles.boxSelectActive : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingGpx(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setIsDraggingGpx(false);
      }}
      onDrop={handleMapDrop}
    >
      {/* GPX Drag & Drop overlay */}
      {isDraggingGpx && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragOverlayContent}>
            <UploadCloud size={48} className={styles.dragIcon} />
            <h3>Drop GPX Track here</h3>
            <p>Will be added to your tracks and used to refine paths and photo locations.</p>
          </div>
        </div>
      )}

      {/* Relocation banner */}
      {isRelocating && (
        <div className={styles.relocateBanner}>
          <Compass size={18} className="animate-pulse" />
          <span>Click anywhere on the map to set the new GPS coordinates</span>
          <button
            className={styles.cancelBtn}
            onClick={() => setIsRelocating(false)}
          >
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* Floating Map Tools (Left Side) */}
      <div className={styles.mapToolGroup}>
        <button
          className={styles.mapControlBtn}
          title="Zoom to all photos"
          onClick={() => setFitTrigger((prev) => prev + 1)}
        >
          <Maximize2 size={18} />
        </button>
        <button
          className={`${styles.mapControlBtn} ${boxSelectMode ? styles.active : ""}`}
          title={boxSelectMode ? "Selection Mode Active" : "Enable Box Selection (or Shift + Drag)"}
          onClick={() => setBoxSelectMode((prev) => !prev)}
        >
          <BoxSelect size={18} />
        </button>
        <input
          type="file"
          ref={gpxFileInputRef}
          accept=".gpx"
          style={{ display: "none" }}
          onChange={handleQuickFileInputChange}
        />
        <button
          className={`${styles.mapControlBtn} ${visibleGpxTracks.length > 0 ? styles.active : ""}`}
          title="GPX Tracks & Upload"
          onClick={() => {
            setActiveModalTab("gpx");
            setShowBaseMapModal(true);
          }}
        >
          <Route size={18} />
        </button>
        <button
          className={`${styles.mapControlBtn} ${showBaseMapModal && activeModalTab === "basemaps" ? styles.active : ""}`}
          title="Base Maps & Layers"
          onClick={() => {
            setActiveModalTab("basemaps");
            setShowBaseMapModal(true);
          }}
        >
          <Layers size={18} />
        </button>
        <button
          className={`${styles.mapControlBtn} ${showHelp ? styles.active : ""}`}
          title="How it works"
          onClick={() => setShowHelp((prev) => !prev)}
        >
          <HelpCircle size={18} />
        </button>
      </div>

      {/* Help Popup */}
      {showHelp && (
        <div className={styles.helpModal}>
          <div className={styles.cardHeader} style={{ padding: "0 0 8px 0" }}>
            <h3>How Georeferencing Works</h3>
            <button className={styles.closeBtn} onClick={() => setShowHelp(false)}>
              <X size={16} />
            </button>
          </div>
          <ul>
            <li>
              <strong style={{ color: "var(--success)" }}>Green Markers:</strong> Photos with verified GPS coordinates stored in Immich.
            </li>
            <li>
              <strong style={{ color: "var(--warning)" }}>Orange Markers:</strong> Photos without GPS, estimated along your route based on chronological capture times.
            </li>
            <li>
              <strong>Relocate:</strong> Click any marker, select &quot;Relocate Marker&quot;, then click anywhere on the map to place it.
            </li>
            <li>
              <strong>Box Select:</strong> Hold <kbd>Shift</kbd> (or click the box icon) and drag on the map to select multiple estimated photos and fix them simultaneously.
            </li>
          </ul>
        </div>
      )}

      {/* Selection Action Toolbar (Bottom Center) */}
      {bounds && (
        <div className={styles.selectionBox}>
          <div className={styles.selectionText}>
            <BoxSelect size={16} />
            <span>
              {selectedItemsInBounds.length} photos ({estimatedInBounds.length} estimated)
            </span>
          </div>
          {estimatedInBounds.length > 0 && (
            <button
              className={`${styles.toolBtn} ${styles.fix}`}
              onClick={handleFixBatchMarkers}
              disabled={isUpdating}
            >
              <CheckCheck size={14} />
              <span>Fix {estimatedInBounds.length} Estimated</span>
            </button>
          )}
          <button
            className={`${styles.toolBtn} ${styles.clear}`}
            onClick={() => setBounds(null)}
          >
            Clear
          </button>
        </div>
      )}

      {/* Leaflet Map */}
      <MapContainer
        center={initialCenter}
        zoom={props.zoom ?? 13}
        className={styles.mapContainer}
        boxZoom={false}
        preferCanvas={true}
      >
        <TileLayer
          key={activeBaseMap.id}
          attribution={activeBaseMap.attribution}
          url={activeBaseMap.url}
          maxZoom={activeBaseMap.maxZoom ?? 19}
          subdomains={activeBaseMap.subdomains ?? "abc"}
        />

        {/* Route connecting verified GPS points and GPX tracks */}
        {georefSegments.map((seg, idx) => (
          <Polyline
            key={`route-seg-${idx}`}
            positions={seg}
            pathOptions={{
              color: "#4250af",
              weight: 3,
              opacity: 0.7,
              dashArray: "4, 6",
            }}
            smoothFactor={1.5}
          />
        ))}

        {/* Photo Markers */}
        {computed.map((it) => {
          const isVerified = !!it.coords;
          const lat = isVerified ? it.coords!.lat : it.estCoords?.lat;
          const lng = isVerified ? it.coords!.lng : it.estCoords?.lng;

          if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
            return null;
          }

          const isSelected = selectedImage?.id === it.id;
          const color = isVerified ? "#10b981" : "#f59e0b";

          return (
            <CircleMarker
              key={it.id}
              center={[lat, lng]}
              radius={isSelected ? 10 : 7}
              interactive={!isRelocating}
              pathOptions={{
                color: isSelected ? "#4250af" : color,
                fillColor: color,
                fillOpacity: 0.85,
                weight: isSelected ? 3 : 2,
              }}
              eventHandlers={{
                click: () => {
                  if (!isRelocating) {
                    setSelectedImage(it);
                  }
                },
              }}
            >
              {(computed.length <= 1500 || isSelected) && (
                <Tooltip direction="top" offset={[0, -6]}>
                  <span>{it.name}</span>
                </Tooltip>
              )}
            </CircleMarker>
          );
        })}

        <RectangleDrawer
          boxSelectMode={boxSelectMode}
          isRelocating={isRelocating}
          setIsRelocating={setIsRelocating}
          bounds={bounds}
          setBounds={setBounds}
          onMapClick={handleMapClick}
        />
        <CameraController
          trigger={fitTrigger}
          coords={allCoords}
          zoomCategoryTarget={props.zoomCategoryTarget}
          computedImages={computed}
          flyToBoundsTarget={flyToBoundsTarget}
          onClearFlyTarget={() => setFlyToBoundsTarget(null)}
        />
      </MapContainer>

      {/* Photo Inspector Panel */}
      {selectedImage && (
        <div className={styles.inspectorCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardTitle}>
              <MapPin size={16} />
              <span>Photo Inspector</span>
            </div>
            <button
              className={styles.closeBtn}
              onClick={() => setSelectedImage(null)}
            >
              <X size={16} />
            </button>
          </div>

          <div className={styles.cardImageHolder}>
            <img
              src={`/api/images/${selectedImage.id}/thumbnail?size=preview${
                props.sessionToken
                  ? `&token=${encodeURIComponent(props.sessionToken)}`
                  : typeof window !== "undefined" && localStorage.getItem("geopic_session_token")
                  ? `&token=${encodeURIComponent(localStorage.getItem("geopic_session_token")!)}`
                  : ""
              }`}
              alt={selectedImage.name}
              className={styles.previewImage}
              loading="lazy"
            />
            <div
              className={`${styles.badgeOverlay} ${
                selectedImage.coords ? styles.verified : styles.estimated
              }`}
            >
              {selectedImage.coords ? (
                <>
                  <CheckCircle2 size={12} />
                  <span>GPS Verified</span>
                </>
              ) : (
                <>
                  <AlertCircle size={12} />
                  <span>Estimated</span>
                </>
              )}
            </div>
          </div>

          <div className={styles.cardBody}>
            <div className={styles.metaRow}>
              <span className={styles.metaValue} style={{ fontSize: 13, fontWeight: 700 }}>
                {selectedImage.name}
              </span>
            </div>
            <div className={styles.metaRow}>
              <Calendar size={14} />
              <span className={styles.metaValue}>
                {new Date(selectedImage.timestamp).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
            <div className={styles.metaRow}>
              <MapPin size={14} />
              <span className={styles.metaValue}>
                {selectedImage.coords
                  ? `${selectedImage.coords.lat.toFixed(5)}, ${selectedImage.coords.lng.toFixed(5)}`
                  : selectedImage.estCoords
                  ? `${selectedImage.estCoords.lat.toFixed(5)}, ${selectedImage.estCoords.lng.toFixed(5)} (approx)`
                  : "No coordinates"}
              </span>
            </div>
            {(selectedImage.city || selectedImage.country) && (
              <div className={styles.metaRow}>
                <Compass size={14} />
                <span className={styles.metaValue}>
                  {[selectedImage.city, selectedImage.country].filter(Boolean).join(", ")}
                </span>
              </div>
            )}
          </div>

          <div className={styles.cardActions}>
            <button
              className={`${styles.actionBtn} ${styles.primary}`}
              onClick={() => setIsRelocating(true)}
              disabled={isUpdating}
            >
              <Compass size={15} />
              <span>Relocate Marker</span>
            </button>

            {!selectedImage.coords && selectedImage.estimated && selectedImage.estCoords && (
              <button
                className={`${styles.actionBtn} ${styles.success}`}
                onClick={handleFixSingleMarker}
                disabled={isUpdating}
              >
                <CheckCircle2 size={15} />
                <span>Fix This Location</span>
              </button>
            )}

            {selectedImage.coords && (
              <button
                className={`${styles.actionBtn} ${styles.danger}`}
                onClick={handleRemoveCoordinates}
                disabled={isUpdating}
              >
                <Trash2 size={15} />
                <span>Remove Coordinates</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Base Map & GPX Layers Manager Modal */}
      <BaseMapModal
        isOpen={showBaseMapModal}
        onClose={() => setShowBaseMapModal(false)}
        baseMaps={baseMaps}
        selectedId={selectedBaseMapId}
        presets={presets}
        onSelectBaseMap={handleSelectBaseMap}
        onAddBaseMap={handleAddBaseMap}
        onDeleteBaseMap={handleDeleteBaseMap}
        gpxTracks={gpxTracks}
        onToggleGpxVisibility={handleToggleGpxVisibility}
        onUploadGpxFile={handleUploadGpxFile}
        onAddGpxUrl={handleAddGpxUrl}
        onDeleteGpxTrack={handleDeleteGpxTrack}
        onZoomToGpxTrack={handleZoomToGpxTrack}
        initialTab={activeModalTab}
      />
    </div>
  );
}
