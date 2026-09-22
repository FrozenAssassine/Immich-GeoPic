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

function computeEstimatedPositions(items: ImageItem[]): EstimatedImageItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const n = items.length;
  // Create clean shallow clones stripped of stale estimation properties
  // so we never mutate the original objects in React state.
  const out: EstimatedImageItem[] = items
    .map((item) => {
      const { estimated, estCoords, ...cleanItem } = item as EstimatedImageItem;
      return {
        ...cleanItem,
        estimated: false,
        estCoords: undefined,
      };
    })
    .sort((a, b) => parseTimeMs(a.timestamp) - parseTimeMs(b.timestamp));

  // Pass 1: Forward scan - find previous geotagged photo index for each photo
  const prevGeoIndex = new Int32Array(n);
  let lastGeo = -1;
  for (let i = 0; i < n; i++) {
    prevGeoIndex[i] = lastGeo;
    if (hasValidCoords(out[i])) {
      lastGeo = i;
    }
  }

  // Pass 2: Backward scan - find next geotagged photo index for each photo
  const nextGeoIndex = new Int32Array(n);
  lastGeo = -1;
  for (let i = n - 1; i >= 0; i--) {
    nextGeoIndex[i] = lastGeo;
    if (hasValidCoords(out[i])) {
      lastGeo = i;
    }
  }

  // Pass 3: Estimate unlocated photo coordinates in O(1) per photo
  for (let i = 0; i < n; i++) {
    if (hasValidCoords(out[i])) {
      out[i].estimated = false;
      out[i].estCoords = undefined;
      continue;
    }

    const prevIndex = prevGeoIndex[i];
    const nextIndex = nextGeoIndex[i];

    if (prevIndex !== -1 && nextIndex !== -1) {
      const tPrev = parseTimeMs(out[prevIndex].timestamp);
      const tNext = parseTimeMs(out[nextIndex].timestamp);
      const tCur = parseTimeMs(out[i].timestamp);
      const diff = tNext - tPrev;
      const ratio = diff > 0 ? (tCur - tPrev) / diff : 0.5;
      const est = interpolateCoords(
        out[prevIndex].coords!,
        out[nextIndex].coords!,
        ratio
      );
      out[i].estimated = true;
      out[i].estCoords = { lat: est.lat, lng: est.lng };
    } else if (prevIndex !== -1) {
      out[i].estimated = true;
      const base = out[prevIndex].coords!;
      out[i].estCoords = {
        lat: base.lat + deterministicOffset(out[i].id, 1),
        lng: base.lng + deterministicOffset(out[i].id, 2),
      };
    } else if (nextIndex !== -1) {
      out[i].estimated = true;
      const base = out[nextIndex].coords!;
      out[i].estCoords = {
        lat: base.lat + deterministicOffset(out[i].id, 3),
        lng: base.lng + deterministicOffset(out[i].id, 4),
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
}

function CameraController({
  trigger,
  coords,
  zoomCategoryTarget,
  computedImages,
}: CameraControllerProps) {
  const map = useMap();
  const prevTriggerRef = useRef(0);
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const prevCategoryTargetRef = useRef<number>(0);

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

  // Sync state if props change from outside
  useEffect(() => {
    setImages(props.images);
  }, [props.images]);

  // Notify parent of state updates
  const updateImages = (newImages: ImageItem[]) => {
    setImages(newImages);
    props.onImagesUpdate?.(newImages);
  };

  const computed = useMemo(() => computeEstimatedPositions(images), [images]);

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
    return [51.5074, -0.1278]; // Default London
  }, [computed, props.center]);

  const georefPositions: LatLngExpression[] = useMemo(() => {
    const pos: [number, number][] = [];
    for (let i = 0; i < computed.length; i++) {
      const c = computed[i].coords;
      if (c) pos.push([c.lat, c.lng]);
    }
    return pos;
  }, [computed]);

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
    return coords;
  }, [computed]);

  return (
    <div
      className={`${styles.mapWrapper} ${isRelocating ? styles.relocateActive : ""} ${
        boxSelectMode ? styles.boxSelectActive : ""
      }`}
    >
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
        <button
          className={`${styles.mapControlBtn} ${showBaseMapModal ? styles.active : ""}`}
          title="Base Maps & Layers"
          onClick={() => setShowBaseMapModal(true)}
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

        {/* Route connecting verified GPS points */}
        {georefPositions.length >= 2 && (
          <Polyline
            positions={georefPositions}
            pathOptions={{
              color: "#4250af",
              weight: 3,
              opacity: 0.7,
              dashArray: "4, 6",
            }}
            smoothFactor={1.5}
          />
        )}

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

      {/* Base Map Manager Modal */}
      <BaseMapModal
        isOpen={showBaseMapModal}
        onClose={() => setShowBaseMapModal(false)}
        baseMaps={baseMaps}
        selectedId={selectedBaseMapId}
        presets={presets}
        onSelectBaseMap={handleSelectBaseMap}
        onAddBaseMap={handleAddBaseMap}
        onDeleteBaseMap={handleDeleteBaseMap}
      />
    </div>
  );
}
