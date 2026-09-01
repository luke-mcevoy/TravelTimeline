import { useState } from 'react';
import { Video, Download, X, Loader2 } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { isNativePlatform } from '@/services/photoSource';
import styles from './VideoExportButton.module.css';

type ExportState = 'idle' | 'rendering' | 'done' | 'error';

export function VideoExportButton() {
  const [state, setState] = useState<ExportState>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [downloadToken, setDownloadToken] = useState('');
  const [showPanel, setShowPanel] = useState(false);
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);

  const destinations = getSortedDestinations();
  const canExport = destinations.length >= 2;

  // Video export depends on the Mac server (Puppeteer + FFmpeg); on the native
  // build it's deferred until an on-device AVFoundation exporter exists.
  if (isNativePlatform) return null;

  const handleExport = async () => {
    if (!canExport) return;
    setState('rendering');
    setProgress(0);
    setError('');

    try {
      const res = await fetch('/api/render-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinations,
          width: 1920,
          height: 1080,
          fps: 30,
          speed: 1,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Render failed');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error('No response stream');

      let done = false;
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) {
          const text = decoder.decode(value, { stream: true });
          const lines = text.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'progress') {
                  setProgress(data.pct);
                } else if (data.type === 'complete') {
                  setDownloadToken(data.token ?? '');
                  setState('done');
                } else if (data.type === 'error') {
                  throw new Error(data.message);
                }
              } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
              }
            }
          }
        }
      }
    } catch (err) {
      setState('error');
      setError(err instanceof Error ? err.message : 'Export failed');
    }
  };

  const handleDownload = () => {
    window.open(`/api/download-video?token=${encodeURIComponent(downloadToken)}`, '_blank');
    setState('idle');
    setShowPanel(false);
  };

  if (!canExport) return null;

  return (
    <>
      <button onClick={() => setShowPanel(true)} className={styles.trigger}>
        <Video className={styles.triggerIcon} />
        Export Video
      </button>

      {showPanel && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h3 className={styles.panelTitle}>Export Video</h3>
            <button
              onClick={() => { setShowPanel(false); setState('idle'); }}
              className={styles.closeButton}
            >
              <X className={styles.closeIcon} />
            </button>
          </div>

          <div className={styles.info}>
            <p>Resolution: 1920 x 1080</p>
            <p>Frame rate: 30 fps</p>
            <p>Destinations: {destinations.length}</p>
          </div>

          {state === 'idle' && (
            <button onClick={handleExport} className={styles.renderButton}>
              <Video className={styles.renderIcon} />
              Start Rendering
            </button>
          )}

          {state === 'rendering' && (
            <div className={styles.progress}>
              <div className={styles.progressLabel}>
                <Loader2 className={styles.progressSpinner} />
                Rendering... {progress}%
              </div>
              <div className={styles.progressBarTrack}>
                <div className={styles.progressBarFill} style={{ width: `${progress}%` }} />
              </div>
              <p className={styles.progressHint}>
                This may take a few minutes. Keep this tab open.
              </p>
            </div>
          )}

          {state === 'done' && (
            <button onClick={handleDownload} className={styles.downloadButton}>
              <Download className={styles.downloadIcon} />
              Download Video
            </button>
          )}

          {state === 'error' && (
            <div className={styles.errorWrapper}>
              <p className={styles.errorText}>{error}</p>
              <button onClick={() => setState('idle')} className={styles.retryLink}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
