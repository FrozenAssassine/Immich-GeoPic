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
} from "lucide-react";

type Props = {
  images: ImageItem[];
  onImagesUpdate?: (images: ImageItem[]) => void;
  center?: LatLngExpression;
  zoom?: number;
  sessionToken?: string | null;
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

function randomOffset(scale = 0.001) {
  return (Math.random() - 0.5) * scale;
}

function computeEstimatedPositions(items: ImageItem[]): EstimatedImageItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const sorted = items
    .map((it) => ({ ...it }))
    .sort((a, b) => parseTimeMs(a.timestamp) - parseTimeMs(b.timestamp));

  const out: EstimatedImageItem[] = sorted.map((it) => ({ ...it }));

  for (let i = 0; i < out.length; i++) {
    if (out[i].coords) continue;

    let prevIndex = -1;
    for (let j = i - 1; j >= 0; j--) {
      if (out[j].coords) {
        prevIndex = j;
        break;
      }
    }

    let nextIndex = -1;
    for (let j = i + 1; j < out.length; j++) {
      if (out[j].coords) {
        nextIndex = j;
        break;
      }
    }

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
        lat: base.lat + randomOffset(),
        lng: base.lng + randomOffset(),
      };
    } else if (nextIndex !== -1) {
      out[i].estimated = true;
      const base = out[nextIndex].coords!;
      out[i].estCoords = {
        lat: base.lat + randomOffset(),
        lng: base.lng + randomOffset(),
      };
    } else {
      out[i].estimated = true;
      out[i].estCoords = {
        lat: 51.5074 + randomOffset(0.05),
        lng: -0.1278 + randomOffset(0.05),
      };
    }
  }

  return out;
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
    return computed
      .filter((i) => i.coords)
      .map((i) => [i.coords!.lat, i.coords!.lng]);
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
    return selectedItemsInBounds.filter((i) => i.estimated && i.estCoords);
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

  // Single marker relocation click
  const handleMapClick = async (e: LeafletMouseEvent) => {
    if (!isRelocating || !selectedImage) return;

    const { lat, lng } = e.latlng;
    setIsRelocating(false);
    setIsUpdating(true);

    try {
      await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords: { lat, lng } }),
      });

      const updated = images.map((img) =>
        img.id === selectedImage.id ? { ...img, coords: { lat, lng } } : img
      );
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
      await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords }),
      });

      const updated = images.map((img) =>
        img.id === selectedImage.id ? { ...img, coords } : img
      );
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
      await fetch(`/api/images/${selectedImage.id}/location`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ coords: null }),
      });

      const updated = images.map((img) =>
        img.id === selectedImage.id ? { ...img, coords: undefined } : img
      );
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

      await fetch("/api/images/bulk-location", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ updates }),
      });

      const updatedMap = new Map(updates.map((u) => [u.id, u.coords]));
      const updated = images.map((img) => {
        const newCoords = updatedMap.get(img.id);
        return newCoords ? { ...img, coords: newCoords } : img;
      });

      updateImages(updated);
      setBounds(null);
    } catch (err) {
      console.error("Failed to bulk fix markers:", err);
    } finally {
      setIsUpdating(false);
    }
  };

  // Fit Bounds component
  function FitBoundsHelper({ trigger }: { trigger: number }) {
    const map = useMap();
    useEffect(() => {
      if (trigger === 0) return;
      const allCoords: [number, number][] = computed
        .map((i) => i.coords || i.estCoords)
        .filter((c): c is { lat: number; lng: number } => !!c && !Number.isNaN(c.lat))
        .map((c) => [c.lat, c.lng]);

      if (allCoords.length > 0) {
        const b = L.latLngBounds(allCoords);
        map.fitBounds(b, { padding: [50, 50], maxZoom: 16 });
      }
    }, [trigger, map]);
    return null;
  }

  const [fitTrigger, setFitTrigger] = useState(0);

  // Rectangle Selection Drawer
  function RectangleDrawer() {
    const map = useMap();
    const [isDrawing, setIsDrawing] = useState(false);
    const [startLatLng, setStartLatLng] = useState<LatLng | null>(null);
    const shiftPressed = useRef(false);

    useMapEvents({
      keydown(e) {
        if (e.originalEvent.key === "Shift") shiftPressed.current = true;
        if (e.originalEvent.key === "Escape") {
          setIsRelocating(false);
          setBounds(null);
        }
      },
      keyup(e) {
        if (e.originalEvent.key === "Shift") shiftPressed.current = false;
      },
      mousedown(e) {
        if (isRelocating) return;
        if (shiftPressed.current || boxSelectMode) {
          setIsDrawing(true);
          setStartLatLng(e.latlng);
          setBounds(null);
          map.dragging.disable();
        }
      },
      mousemove(e) {
        if (isDrawing && startLatLng) {
          const newBounds = L.latLngBounds(startLatLng, e.latlng);
          setBounds(newBounds);
        }
      },
      mouseup(e) {
        if (isDrawing && startLatLng) {
          const finalBounds = L.latLngBounds(startLatLng, e.latlng);
          setBounds(finalBounds);
        }
        setIsDrawing(false);
        setStartLatLng(null);
        map.dragging.enable();
      },
      click(e) {
        handleMapClick(e);
      },
    });

    return bounds ? (
      <Rectangle
        bounds={bounds}
        pathOptions={{
          color: "#4250af",
          weight: 2,
          fillColor: "#4250af",
          fillOpacity: 0.12,
          dashArray: "6, 6",
        }}
      />
    ) : null;
  }

  return (
    <div
      className={`${styles.mapWrapper} ${isRelocating ? styles.relocateActive : ""}`}
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
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
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
              <Tooltip direction="top" offset={[0, -6]}>
                <span>{it.name}</span>
              </Tooltip>
            </CircleMarker>
          );
        })}

        <RectangleDrawer />
        <FitBoundsHelper trigger={fitTrigger} />
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

            {selectedImage.estimated && selectedImage.estCoords && (
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
    </div>
  );
}
