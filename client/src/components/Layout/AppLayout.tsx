import { GlobeView } from '@/components/Globe/GlobeView'
import { Starfield } from '@/components/Globe/Starfield'
import { MoonScene } from '@/components/Globe/MoonScene'
import { FeaturedDestination } from '@/components/Globe/FeaturedDestination'
import { AroundTheWorld } from '@/components/Globe/AroundTheWorld'
import { Passport } from '@/components/Globe/Passport'
import { HudFrame } from '@/components/Layout/HudFrame'
import { TripPanel } from '@/components/TripManager/TripPanel'
import { TimelineBar } from '@/components/Timeline/TimelineBar'
import { VideoExportButton } from '@/components/VideoExport/VideoExportButton'
import { StatsBar } from '@/components/Layout/StatsBar'
import { useUiStore } from '@/stores/uiStore'
import styles from './AppLayout.module.css'

export function AppLayout() {
  const toggleSkittleMode = useUiStore((s) => s.toggleSkittleMode)
  return (
    <div className={styles.root}>
      {/* Easter egg: turns the Moon into a giant red Skittle. Visible for now
          (top-left); can be hidden again later. */}
      <button
        onClick={toggleSkittleMode}
        aria-label="Toggle Skittle moon"
        title="Skittle moon"
        style={{
          position: 'fixed',
          top: 'calc(var(--safe-top) + 6px)',
          left: 'calc(var(--safe-left) + 6px)',
          width: 30,
          height: 30,
          zIndex: 60,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #ff5a68, #c8102e)',
          border: '1px solid rgba(255,255,255,0.55)',
          boxShadow: '0 0 10px rgba(200,16,46,0.6), inset 0 -2px 4px rgba(0,0,0,0.3)',
          color: '#fff',
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontWeight: 900,
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        S
      </button>
      <Starfield />
      <MoonScene />
      <div className={styles.globeWrap}>
        <div className={styles.globeGlow} />
        <GlobeView />
      </div>
      <HudFrame />
      <FeaturedDestination />
      <TripPanel />
      <TimelineBar />
      <StatsBar />
      <AroundTheWorld />
      <Passport />
      <VideoExportButton />
    </div>
  )
}
