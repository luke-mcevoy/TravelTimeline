import { useEffect, useRef, useState } from 'react';
import { Film, Share2, Download, X, Loader2, Check } from 'lucide-react';
import { useTripStore } from '@/stores/tripStore';
import { useGlobeStore } from '@/stores/globeStore';
import { recordReel, reelSupported, type ReelResult } from '@/utils/reel';
import { isNativePlatform } from '@/services/photoSource';
import { Photos } from '@/native/photos';
import styles from './ReelExport.module.css';

/** Read a Blob as a bare base64 string (no data: prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Read failed'));
    reader.readAsDataURL(blob);
  });
}

type State = 'idle' | 'recording' | 'done' | 'error';

export function ReelExport() {
  const getSortedDestinations = useTripStore((s) => s.getSortedDestinations);
  const globeInstance = useGlobeStore((s) => s.globeInstance);
  const destinations = getSortedDestinations();

  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [label, setLabel] = useState('');
  const [pct, setPct] = useState(0);
  const [error, setError] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const resultRef = useRef<ReelResult | null>(null);

  // Revoke the object URL when it changes / unmounts.
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (destinations.length < 2 || !globeInstance || !reelSupported()) return null;

  const start = async () => {
    if (!globeInstance) return;
    setState('recording');
    setLabel('Preparing…');
    setPct(0);
    setError('');
    // Stop any in-app playback so it doesn't fight the reel's scripted camera.
    useTripStore.getState().setAnimation({ isPlaying: false });

    try {
      const result = await recordReel(globeInstance, destinations, (l, p) => {
        setLabel(l);
        setPct(p);
      });
      resultRef.current = result;
      setUrl(URL.createObjectURL(result.blob));
      setState('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recording failed.');
      setState('error');
    }
  };

  const share = async () => {
    const r = resultRef.current;
    if (!r) return;
    const file = new File([r.blob], `travel-reel.${r.ext}`, { type: r.mimeType });
    const nav = navigator as Navigator & {
      canShare?: (data?: ShareData) => boolean;
    };
    try {
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: 'My Travel Reel' });
        return;
      }
    } catch {
      /* user cancelled or share failed — fall through to download */
    }
    download();
  };

  const download = async () => {
    const r = resultRef.current;
    if (!r) return;

    // iOS WKWebView ignores <a download>, so save straight to the Photos
    // library through the native bridge instead.
    if (isNativePlatform) {
      try {
        setSaveState('saving');
        const data = await blobToBase64(r.blob);
        await Photos.saveVideo({ data, ext: r.ext });
        setSaveState('saved');
        window.setTimeout(() => setSaveState('idle'), 2400);
      } catch {
        setSaveState('error');
        window.setTimeout(() => setSaveState('idle'), 2400);
      }
      return;
    }

    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `travel-reel.${r.ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const close = () => {
    setOpen(false);
    setState('idle');
    setPct(0);
    setSaveState('idle');
  };

  return (
    <>
      <button className={styles.trigger} onClick={() => setOpen(true)}>
        <Film className={styles.triggerIcon} />
        <span className={styles.triggerText}>REEL</span>
      </button>

      {open && (
        <div className={styles.backdrop}>
          <div className={styles.card}>
            <button className={styles.closeBtn} onClick={close} aria-label="Close">
              <X size={18} />
            </button>

            {state === 'idle' && (
              <div className={styles.body}>
                <Film className={styles.hero} />
                <h2 className={styles.title}>Travel Reel</h2>
                <p className={styles.sub}>
                  A vertical, share-ready video of your journey — globe flythrough,
                  your best photos, and your stats. Built in real time (~30s).
                </p>
                <button className={styles.primary} onClick={start}>
                  <Film size={18} />
                  Create Reel
                </button>
              </div>
            )}

            {state === 'recording' && (
              <div className={styles.body}>
                <Loader2 className={styles.spinner} />
                <h2 className={styles.title}>{label}</h2>
                <p className={styles.sub}>
                  Recording in real time — keep the app in the foreground.
                </p>
                <div className={styles.track}>
                  <div className={styles.fill} style={{ width: `${pct}%` }} />
                </div>
                <p className={styles.pct}>{pct}%</p>
              </div>
            )}

            {state === 'done' && url && (
              <div className={styles.body}>
                <video className={styles.preview} src={url} controls autoPlay loop playsInline />
                <div className={styles.actions}>
                  <button className={styles.primary} onClick={share}>
                    <Share2 size={18} />
                    Share
                  </button>
                  <button
                    className={styles.secondary}
                    onClick={download}
                    disabled={saveState === 'saving'}
                  >
                    {saveState === 'saving' ? (
                      <>
                        <Loader2 size={18} className={styles.spinnerInline} />
                        Saving…
                      </>
                    ) : saveState === 'saved' ? (
                      <>
                        <Check size={18} />
                        Saved
                      </>
                    ) : (
                      <>
                        <Download size={18} />
                        {saveState === 'error' ? 'Try again' : 'Save'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {state === 'error' && (
              <div className={styles.body}>
                <h2 className={styles.title}>Couldn’t make the reel</h2>
                <p className={styles.sub}>{error}</p>
                <button className={styles.primary} onClick={() => setState('idle')}>
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
