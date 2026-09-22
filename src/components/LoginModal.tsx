'use client';

import React, { useState } from "react";
import styles from "./LoginModal.module.scss";
import { MapPin, Mail, Lock, AlertCircle, Loader2 } from "lucide-react";

export type LoginModalProps = {
  isOpen: boolean;
  onLoginSuccess: (
    user: { id: string; name: string; email: string },
    token?: string
  ) => void;
};

export default function LoginModal({ isOpen, onLoginSuccess }: LoginModalProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Login failed. Check your credentials.");
      }

      onLoginSuccess(data.user, data.token);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      console.error("[LoginModal] Login error:", message);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <div className={styles.logoIcon}>
          <MapPin size={28} />
        </div>
        <h2 className={styles.title}>Immich GeoPic</h2>
        <p className={styles.subtitle}>Sign in with your Immich account to get started</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.errorBanner}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label}>Immich Email</label>
            <div className={styles.inputWrapper}>
              <Mail size={16} className={styles.inputIcon} />
              <input
                type="email"
                required
                className={styles.input}
                placeholder="user@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Immich Password</label>
            <div className={styles.inputWrapper}>
              <Lock size={16} className={styles.inputIcon} />
              <input
                type="password"
                required
                className={styles.input}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Signing In...</span>
              </>
            ) : (
              <span>Sign In</span>
            )}
          </button>
        </form>

        <p className={styles.securityNote}>
          Your credentials are authenticated directly through GeoPic server proxy. Immich tokens are kept secure server-side.
        </p>
      </div>
    </div>
  );
}
