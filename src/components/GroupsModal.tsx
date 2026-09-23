'use client';

import React, { useState, useEffect } from "react";
import styles from "./GroupsModal.module.scss";
import { VirtualGroup } from "@/types/VirtualGroup";
import {
  Layers,
  X,
  Plus,
  Trash2,
  Edit2,
  Maximize2,
  MapPin,
  CircleDot,
  CheckCircle2,
  AlertCircle,
  Compass,
  Check,
  Crosshair,
} from "lucide-react";

export interface GroupsModalProps {
  isOpen: boolean;
  onClose: () => void;
  groups: VirtualGroup[];
  onSaveGroup: (group: Omit<VirtualGroup, "id" | "createdAt"> & { id?: string }) => Promise<void>;
  onDeleteGroup: (id: string) => Promise<void>;
  onZoomToGroup: (group: VirtualGroup) => void;
  mapCenter?: { lat: number; lng: number };
  onStartPickOnMap?: () => void;
  pickedCoords?: { lat: number; lng: number } | null;
  onClearPickedCoords?: () => void;
}

const RADIUS_PRESETS = [
  { label: "100 m", value: 100 },
  { label: "500 m", value: 500 },
  { label: "1 km", value: 1000 },
  { label: "5 km", value: 5000 },
  { label: "20 km", value: 20000 },
];

export default function GroupsModal({
  isOpen,
  onClose,
  groups,
  onSaveGroup,
  onDeleteGroup,
  onZoomToGroup,
  mapCenter,
  onStartPickOnMap,
  pickedCoords,
  onClearPickedCoords,
}: GroupsModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [isArea, setIsArea] = useState(false);
  const [radius, setRadius] = useState(1000);
  const [lat, setLat] = useState<number>(mapCenter?.lat ?? 51.5074);
  const [lng, setLng] = useState<number>(mapCenter?.lng ?? -0.1278);
  const [directFix, setDirectFix] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync picked coords if user clicked on map while picking
  useEffect(() => {
    if (pickedCoords) {
      setLat(Number(pickedCoords.lat.toFixed(6)));
      setLng(Number(pickedCoords.lng.toFixed(6)));
      onClearPickedCoords?.();
    }
  }, [pickedCoords, onClearPickedCoords]);

  // Sync map center if creating new
  useEffect(() => {
    if (!isEditing && mapCenter && !editId) {
      setLat(Number(mapCenter.lat.toFixed(6)));
      setLng(Number(mapCenter.lng.toFixed(6)));
    }
  }, [mapCenter, isEditing, editId]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (isEditing) {
          setIsEditing(false);
          setEditId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isEditing, onClose]);

  if (!isOpen) return null;

  const handleStartCreate = () => {
    setEditId(null);
    setName("");
    setIsArea(false);
    setRadius(1000);
    if (mapCenter) {
      setLat(Number(mapCenter.lat.toFixed(6)));
      setLng(Number(mapCenter.lng.toFixed(6)));
    }
    setDirectFix(true);
    setError(null);
    setIsEditing(true);
  };

  const handleStartEdit = (g: VirtualGroup) => {
    setEditId(g.id);
    setName(g.name);
    setIsArea(g.radius > 0);
    setRadius(g.radius > 0 ? g.radius : 1000);
    setLat(Number(g.lat.toFixed(6)));
    setLng(Number(g.lng.toFixed(6)));
    setDirectFix(g.directFix);
    setError(null);
    setIsEditing(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Please provide a group name");
      return;
    }

    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setError("Please enter valid coordinates (-90 to 90 lat, -180 to 180 lng)");
      return;
    }

    setIsSubmitting(true);
    try {
      await onSaveGroup({
        id: editId || undefined,
        name: trimmedName,
        lat,
        lng,
        radius: isArea ? Math.max(1, radius) : 0,
        directFix,
      });
      setIsEditing(false);
      setEditId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save group";
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatRadius = (r: number) => {
    if (r >= 1000) {
      return `${(r / 1000).toFixed(r % 1000 === 0 ? 0 : 1)} km`;
    }
    return `${r} m`;
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.headerIcon}>
              <Layers size={20} />
            </div>
            <div>
              <h2 className={styles.title}>Virtual Marker Groups</h2>
              <p className={styles.subtitle}>
                Quick position targets for photos (Markers &amp; Areas)
              </p>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {error && <div className={styles.errorMessage}>{error}</div>}

          {/* Group Creation / Editing Form */}
          {isEditing ? (
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.formTitle}>
                <span>{editId ? "Edit Group" : "Create New Group"}</span>
              </div>

              <div className={styles.formRow}>
                <label className={styles.label}>Group Name</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Home, Office, Tuscany Vacation"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>

              {/* Type: Marker vs Area */}
              <div className={styles.formRow}>
                <label className={styles.label}>Group Type</label>
                <div className={styles.typeSwitch}>
                  <button
                    type="button"
                    className={`${styles.typeBtn} ${!isArea ? styles.active : ""}`}
                    onClick={() => setIsArea(false)}
                  >
                    <MapPin size={14} />
                    <span>Marker (Point)</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.typeBtn} ${isArea ? styles.active : ""}`}
                    onClick={() => setIsArea(true)}
                  >
                    <CircleDot size={14} />
                    <span>Area (Radius)</span>
                  </button>
                </div>
              </div>

              {/* Radius if Area */}
              {isArea && (
                <div className={styles.formRow}>
                  <label className={styles.label}>Radius: {formatRadius(radius)}</label>
                  <input
                    type="range"
                    min={50}
                    max={50000}
                    step={50}
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                  />
                  <div className={styles.presetsRow}>
                    {RADIUS_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={`${styles.presetBtn} ${radius === preset.value ? styles.active : ""}`}
                        onClick={() => setRadius(preset.value)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Position coordinates */}
              <div className={styles.formRow}>
                <label className={styles.label}>Target Position</label>
                <div className={styles.coordGrid}>
                  <div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Latitude</span>
                    <input
                      type="number"
                      step="any"
                      className={styles.input}
                      value={lat}
                      onChange={(e) => setLat(parseFloat(e.target.value))}
                    />
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Longitude</span>
                    <input
                      type="number"
                      step="any"
                      className={styles.input}
                      value={lng}
                      onChange={(e) => setLng(parseFloat(e.target.value))}
                    />
                  </div>
                </div>
                <div className={styles.coordActions}>
                  {mapCenter && (
                    <button
                      type="button"
                      className={styles.quickCoordBtn}
                      onClick={() => {
                        setLat(Number(mapCenter.lat.toFixed(6)));
                        setLng(Number(mapCenter.lng.toFixed(6)));
                      }}
                    >
                      <Compass size={13} />
                      <span>Use Map Center</span>
                    </button>
                  )}
                  {onStartPickOnMap && (
                    <button
                      type="button"
                      className={styles.quickCoordBtn}
                      onClick={() => {
                        onStartPickOnMap();
                      }}
                    >
                      <Crosshair size={13} />
                      <span>Pick on Map</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Direct Fix Option */}
              <div className={styles.formRow}>
                <label className={styles.label}>Positioning Mode</label>
                <div className={styles.toggleOptions}>
                  <div
                    className={`${styles.toggleOpt} ${directFix ? styles.fixActive : ""}`}
                    onClick={() => setDirectFix(true)}
                  >
                    <div className={styles.optTitle}>
                      <CheckCircle2 size={14} color="#10b981" />
                      <span>Direct Fix</span>
                    </div>
                    <span className={styles.optDesc}>
                      Saves GPS coordinates permanently to Immich for the photo (Green).
                    </span>
                  </div>

                  <div
                    className={`${styles.toggleOpt} ${!directFix ? styles.estActive : ""}`}
                    onClick={() => setDirectFix(false)}
                  >
                    <div className={styles.optTitle}>
                      <AlertCircle size={14} color="#f59e0b" />
                      <span>Estimated</span>
                    </div>
                    <span className={styles.optDesc}>
                      Aligns photo via internal GPX track without writing to Immich (Yellow).
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.formButtons}>
                <button
                  type="button"
                  className={styles.cancelFormBtn}
                  onClick={() => {
                    setIsEditing(false);
                    setEditId(null);
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.saveBtn}
                  disabled={isSubmitting}
                >
                  <Check size={14} />
                  <span>{isSubmitting ? "Saving..." : editId ? "Update Group" : "Create Group"}</span>
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className={styles.topActions}>
                <span className={styles.sectionTitle}>
                  Your Groups ({groups.length})
                </span>
                <button
                  className={styles.createBtn}
                  onClick={handleStartCreate}
                >
                  <Plus size={14} />
                  <span>New Group</span>
                </button>
              </div>

              {groups.length === 0 ? (
                <div className={styles.emptyState}>
                  <Layers size={36} />
                  <strong>No groups created yet</strong>
                  <p>
                    Create a Marker (e.g. Home, Work) or an Area (e.g. Vacation) to quickly assign photo positions.
                  </p>
                </div>
              ) : (
                <div className={styles.groupsList}>
                  {groups.map((g) => (
                    <div key={g.id} className={styles.groupCard}>
                      <div className={styles.groupInfo}>
                        <div className={styles.groupTitleRow}>
                          <span className={styles.groupName}>{g.name}</span>
                          <span className={styles.typeBadge}>
                            {g.radius > 0 ? `Area (${formatRadius(g.radius)})` : "Marker"}
                          </span>
                          <span
                            className={`${styles.fixBadge} ${
                              g.directFix ? styles.directFix : styles.estimated
                            }`}
                          >
                            {g.directFix ? "Direct Fix" : "Estimated"}
                          </span>
                        </div>
                        <span className={styles.coordsText}>
                          {g.lat.toFixed(5)}, {g.lng.toFixed(5)}
                        </span>
                      </div>

                      <div className={styles.groupActions}>
                        <button
                          className={styles.iconBtn}
                          title="Zoom to group on map"
                          onClick={() => {
                            onZoomToGroup(g);
                            onClose();
                          }}
                        >
                          <Maximize2 size={14} />
                        </button>
                        <button
                          className={styles.iconBtn}
                          title="Edit group"
                          onClick={() => handleStartEdit(g)}
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          className={`${styles.iconBtn} ${styles.delete}`}
                          title="Delete group"
                          onClick={() => onDeleteGroup(g.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
