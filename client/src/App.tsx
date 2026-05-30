import { AppLayout } from '@/components/Layout/AppLayout'
import { RenderView } from '@/components/Globe/RenderView'
import { MarkerOverlay } from '@/components/Globe/MarkerOverlay'

const isRenderMode = window.location.pathname === '/render';

export default function App() {
  if (isRenderMode) {
    return <RenderView />
  }
  return (
    <>
      <AppLayout />
      <MarkerOverlay />
    </>
  )
}
