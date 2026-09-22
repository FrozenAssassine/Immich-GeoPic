'use client';

import React, { useState, useEffect } from "react";
import styles from "./BaseMapModal.module.scss";
import { BaseMap, BaseMapPreset } from "@/types/BaseMap";
import {
  Layers,
  X,
  Plus,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";

export type BaseMapModalProps = {
  isOpen: boolean;
  onClose: () => void;
  baseMaps: BaseMap[];
  selectedId: string;
  presets: BaseMapPreset[];
  onSelectBaseMap: (id: string) => void;
  onAddBaseMap: (map: Omit<BaseMap, "id" | "isDefault">) => Promise<void>;
  onDeleteBaseMap: (id: string) => Promise<void>;
};

export default function BaseMapModal({
  isOpen,
  onClose,
  baseMaps,
  selectedId,
  presets,
  onSelectBaseMap,
  onAddBaseMap,
  onDeleteBaseMap,
}: BaseMapModalProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [attribution, setAttribution] = useState("");
  const [maxZoom, setMaxZoom] = useState(19);
  const [subdomains, setSubdomains] = useState("abc");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (isAdding) {
          setIsAdding(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isAdding, onClose]);

  if (!isOpen) return null;

  const handleApplyPreset = (preset: BaseMapPreset) => {
    setName(preset.name);
    setUrl(preset.url);
    setAttribution(preset.attribution || "");
    setMaxZoom(preset.maxZoom || 19);
    setSubdomains(preset.subdomains || "abc");
    setError(null);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedUrl = url.trim();

    if (!trimmedName) {
      setError("Please provide a name for the base map.");
      return;
    }

    if (!trimmedUrl) {
      setError("Please provide a tile URL template.");
      return;
    }

    if (
      !trimmedUrl.includes("{z}") ||
      !trimmedUrl.includes("{x}") ||
      !trimmedUrl.includes("{y}")
    ) {
      setError("The URL template must contain {z}, {x}, and {y} coordinate tokens.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onAddBaseMap({
        name: trimmedName,
        url: trimmedUrl,
        attribution: attribution.trim(),
        maxZoom: Number(maxZoom) || 19,
        subdomains: subdomains.trim() || "abc",
      });
      // Reset form
      setName("");
      setUrl("");
      setAttribution("");
      setMaxZoom(19);
      setSubdomains("abc");
      setIsAdding(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add base map");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Are you sure you want to remove this base map?")) return;

    setDeletingId(id);
    setError(null);
    try {
      await onDeleteBaseMap(id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete base map");
    } finally {
      setDeletingId(null);
    }
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
              <h2 className={styles.title}>Base Maps</h2>
              <span className={styles.subtitle}>Choose or configure map tile providers</span>
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className={styles.content}>
          {error && (
            <div className={styles.errorBanner}>
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}

          {/* Current Base Maps */}
          <div>
            <div className={styles.sectionTitle}>Available Base Maps</div>
            <div className={styles.mapList}>
              {baseMaps.map((map) => {
                const isSelected = selectedId === map.id;
                const isDeleting = deletingId === map.id;

                return (
                  <div
                    key={map.id}
                    className={`${styles.mapItem} ${isSelected ? styles.active : ""}`}
                    onClick={() => onSelectBaseMap(map.id)}
                  >
                    <div className={styles.mapItemLeft}>
                      <div className={styles.radioIndicator} />
                      <div className={styles.mapItemInfo}>
                        <span className={styles.mapItemName}>{map.name}</span>
                        <div className={styles.mapItemMeta}>
                          {map.isDefault ? (
                            <span className={`${styles.tag} ${styles.default}`}>Default</span>
                          ) : (
                            <span className={`${styles.tag} ${styles.custom}`}>Custom</span>
                          )}
                          {map.maxZoom && (
                            <span className={styles.subtitle}>Max Zoom: {map.maxZoom}</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {!map.isDefault && (
                      <button
                        className={styles.deleteBtn}
                        onClick={(e) => handleDelete(map.id, e)}
                        disabled={isDeleting}
                        title="Remove base map"
                      >
                        {isDeleting ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add Base Map Section */}
          <div className={styles.addSection}>
            {!isAdding ? (
              <button
                className={styles.toggleAddBtn}
                onClick={() => {
                  setError(null);
                  setIsAdding(true);
                }}
              >
                <Plus size={16} />
                <span>Add Custom Base Map</span>
              </button>
            ) : (
              <form className={styles.addForm} onSubmit={handleAddSubmit}>
                <div className={styles.sectionTitle} style={{ marginBottom: 0 }}>
                  Add Base Map
                </div>

                {/* Preset Chips */}
                {presets && presets.length > 0 && (
                  <div className={styles.presetBar}>
                    <div className={styles.presetLabel}>
                      <Sparkles size={11} style={{ display: "inline", marginRight: 4 }} />
                      Quick Presets:
                    </div>
                    <div className={styles.presetChips}>
                      {presets.map((p) => (
                        <button
                          key={p.name}
                          type="button"
                          className={styles.presetChip}
                          onClick={() => handleApplyPreset(p)}
                        >
                          {p.name.split(" ")[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className={styles.field}>
                  <label className={styles.label}>Name</label>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. Esri Satellite, OpenTopoMap"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Tile URL Template</label>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="https://{s}.tile.example.com/{z}/{x}/{y}.png"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                  />
                  <span className={styles.hint}>
                    Must include standard tile tokens: <code>{`{z}`}</code>, <code>{`{x}`}</code>, and <code>{`{y}`}</code>. Optional: <code>{`{s}`}</code>.
                  </span>
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Attribution / Copyright (Optional)</label>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="e.g. &copy; OpenTopoMap contributors"
                    value={attribution}
                    onChange={(e) => setAttribution(e.target.value)}
                  />
                </div>

                <div className={styles.formRow}>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label className={styles.label}>Max Zoom</label>
                    <input
                      type="number"
                      className={styles.input}
                      min={1}
                      max={24}
                      value={maxZoom}
                      onChange={(e) => setMaxZoom(Number(e.target.value))}
                    />
                  </div>
                  <div className={styles.field} style={{ flex: 1 }}>
                    <label className={styles.label}>Subdomains</label>
                    <input
                      type="text"
                      className={styles.input}
                      placeholder="abc"
                      value={subdomains}
                      onChange={(e) => setSubdomains(e.target.value)}
                    />
                  </div>
                </div>

                <div className={styles.formActions}>
                  <button
                    type="button"
                    className={styles.cancelBtn}
                    onClick={() => {
                      setIsAdding(false);
                      setError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className={styles.saveBtn}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <Check size={14} />
                        <span>Save Base Map</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
