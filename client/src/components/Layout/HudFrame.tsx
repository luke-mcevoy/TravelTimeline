import styles from './HudFrame.module.css';

/**
 * Minimal, non-interactive overlay. Just a soft vignette to add depth around
 * the globe — the heavy cockpit chrome (grid, scanlines, brackets, telemetry)
 * was removed so the photos and globe can breathe.
 */
export function HudFrame() {
  return (
    <div className={styles.root} aria-hidden>
      <div className={styles.vignette} />
    </div>
  );
}
