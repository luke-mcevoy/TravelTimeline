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
import { ReelExport } from '@/components/VideoExport/ReelExport'
import { StatsBar } from '@/components/Layout/StatsBar'
import styles from './AppLayout.module.css'

export function AppLayout() {
  return (
    <div className={styles.root}>
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
      <ReelExport />
      <VideoExportButton />
    </div>
  )
}
