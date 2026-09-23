'use client';

import React, { useEffect } from "react";
import styles from "./MixedSelectionDialog.module.scss";
import { AlertTriangle, X, Check, ArrowRight } from "lucide-react";

export interface MixedSelectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  groupName: string;
  fixedCount: number;
  estimatedCount: number;
  onConfirm: (applyTo: "all" | "estimatedOnly") => void;
}

export default function MixedSelectionDialog({
  isOpen,
  onClose,
  groupName,
  fixedCount,
  estimatedCount,
  onConfirm,
}: MixedSelectionDialogProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const total = fixedCount + estimatedCount;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}>
            <AlertTriangle size={18} />
            <span>Move to Estimated Group: &quot;{groupName}&quot;</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <p>
            Your current selection contains photos that already have verified GPS coordinates saved in Immich as well as unreferenced/estimated photos.
          </p>

          <div className={styles.stats}>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Verified GPS</span>
              <span className={styles.statValue} style={{ color: "var(--success)" }}>
                {fixedCount}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Estimated</span>
              <span className={styles.statValue} style={{ color: "var(--warning)" }}>
                {estimatedCount}
              </span>
            </div>
            <div className={styles.statItem}>
              <span className={styles.statLabel}>Total</span>
              <span className={styles.statValue}>{total}</span>
            </div>
          </div>

          <div className={styles.warningBox}>
            <AlertTriangle size={16} />
            <span>
              Moving verified photos to an estimated group will <strong>remove their coordinates from Immich</strong> so they are dynamically positioned via the group.
            </span>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.actionRow}>
            <button
              className={`${styles.btn} ${styles.primary}`}
              onClick={() => onConfirm("all")}
            >
              <ArrowRight size={14} />
              <span>All Photos ({total})</span>
            </button>
            <button
              className={`${styles.btn} ${styles.secondary}`}
              onClick={() => onConfirm("estimatedOnly")}
            >
              <Check size={14} />
              <span>Just Estimated ({estimatedCount})</span>
            </button>
          </div>
          <button
            className={`${styles.btn} ${styles.cancel}`}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
