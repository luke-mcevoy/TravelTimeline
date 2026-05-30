import { GlobeView } from '@/components/Globe/GlobeView'
import { Starfield } from '@/components/Globe/Starfield'
import { FeaturedDestination } from '@/components/Globe/FeaturedDestination'
import { HudFrame } from '@/components/Layout/HudFrame'
import { TripPanel } from '@/components/TripManager/TripPanel'
import { TimelineBar } from '@/components/Timeline/TimelineBar'
import { VideoExportButton } from '@/components/VideoExport/VideoExportButton'
import { StatsBar } from '@/components/Layout/StatsBar'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={styles.root}>
      <Starfield />
      <div className={styles.globeWrap}>
        <div className={styles.globeGlow} />
        <GlobeView />
      </div>
      <HudFrame />
      <FeaturedDestination />
      <TripPanel />
      <TimelineBar />
      <StatsBar />
      <VideoExportButton />
    </div>
  )
}
