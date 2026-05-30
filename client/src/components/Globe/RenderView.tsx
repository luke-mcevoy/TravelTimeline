import { useEffect, useRef, useState, useCallback } from 'react';
import Globe, { type GlobeInstance } from 'globe.gl';
import * as THREE from 'three';
import type { SortedDestination } from '@/types';
import styles from './RenderView.module.css';

const GLOBE_IMAGE = '/earth-day-8k.jpg';
const BUMP_IMAGE = '/earth-topology.png';
const WATER_IMAGE = '/earth-water.png';

const win = window as unknown as Record<string, unknown>;

interface ArcData {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string[];
}

interface PointData {
  lat: number;
  lng: number;
  label: string;
  color: string;
  radius: number;
}

export function RenderView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [destinations, setDestinations] = useState<SortedDestination[]>([]);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const data = win.__RENDER_DATA__ as SortedDestination[] | undefined;
    if (data && data.length > 0) {
      setDestinations(data);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || globeRef.current || destinations.length === 0) return;

    const w = (win.__RENDER_WIDTH__ as number) || 1920;
    const h = (win.__RENDER_HEIGHT__ as number) || 1080;

    const globe = new Globe(containerRef.current)
      .width(w)
      .height(h)
      .globeImageUrl(GLOBE_IMAGE)
      .bumpImageUrl(BUMP_IMAGE)
      .backgroundColor('#03060d')
      .showAtmosphere(true)
      .atmosphereColor('#38e1ff')
      .atmosphereAltitude(0.22)
      .pointOfView({ lat: destinations[0].lat, lng: destinations[0].lng, altitude: 2.5 })
      .pointColor('color' as never)
      .pointAltitude(0.01)
      .pointRadius('radius' as never)
      .pointLabel('label' as never)
      .arcColor('color' as never)
      .arcStroke(0.5)
      .arcDashLength(0.4)
      .arcDashGap(0.2)
      .arcDashAnimateTime(1500)
      .arcsTransitionDuration(0)
      .pointsTransitionDuration(0);

    // Crisp textures + ocean specular to match the live globe
    const maxAnisotropy = globe.renderer().capabilities.getMaxAnisotropy();
    const mat = globe.globeMaterial() as THREE.MeshPhongMaterial;
    const sharpen = window.setInterval(() => {
      if (mat.map) {
        mat.map.anisotropy = maxAnisotropy;
        mat.map.needsUpdate = true;
      }
      if (mat.bumpMap) {
        mat.bumpMap.anisotropy = maxAnisotropy;
        mat.bumpMap.needsUpdate = true;
        mat.bumpScale = 6;
        window.clearInterval(sharpen);
      }
    }, 100);
    new THREE.TextureLoader().load(WATER_IMAGE, (waterTex) => {
      waterTex.anisotropy = maxAnisotropy;
      mat.specularMap = waterTex;
      mat.specular = new THREE.Color('#1b2a38');
      mat.shininess = 16;
      mat.needsUpdate = true;
    });

    globeRef.current = globe;

    setTimeout(() => {
      setIsReady(true);
      win.__GLOBE_READY__ = true;
    }, 2000);

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = '';
      globeRef.current = null;
    };
  }, [destinations]);

  const updateVisuals = useCallback(
    (upToIndex: number) => {
      if (!globeRef.current) return;
      const visible = destinations.slice(0, upToIndex + 1);

      const points: PointData[] = visible.map((d, i) => ({
        lat: d.lat,
        lng: d.lng,
        label: `${d.city}, ${d.country}`,
        color: i === visible.length - 1 ? '#ffffff' : '#38e1ff',
        radius: i === visible.length - 1 ? 0.5 : 0.3,
      }));

      const arcs: ArcData[] = [];
      for (let i = 1; i < visible.length; i++) {
        arcs.push({
          startLat: visible[i - 1].lat,
          startLng: visible[i - 1].lng,
          endLat: visible[i].lat,
          endLng: visible[i].lng,
          color: ['#38e1ff40', '#6fe9ffcc'],
        });
      }

      globeRef.current.pointsData(points);
      globeRef.current.arcsData(arcs);
    },
    [destinations]
  );

  useEffect(() => {
    if (!isReady || destinations.length === 0) return;

    const handleAdvance = () => {
      setCurrentIndex((prev) => {
        const next = prev + 1;
        if (next >= destinations.length) {
          win.__ANIMATION_DONE__ = true;
          return prev;
        }
        const dest = destinations[next];
        globeRef.current?.pointOfView(
          { lat: dest.lat, lng: dest.lng, altitude: 1.5 },
          0
        );
        updateVisuals(next);

        setTimeout(() => {
          win.__FRAME_READY__ = true;
        }, 100);

        return next;
      });
    };

    win.__advanceFrame__ = handleAdvance;

    updateVisuals(0);
    setTimeout(() => {
      win.__FRAME_READY__ = true;
    }, 500);
  }, [isReady, destinations, updateVisuals]);

  const currentDest = destinations[currentIndex];

  return (
    <div className={styles.root}>
      <div ref={containerRef} className={styles.canvas} />
      {currentDest && (
        <div className={styles.overlay}>
          <div className={styles.overlayInner}>
            <p className={styles.cityLabel}>
              {currentDest.city}, {currentDest.country}
            </p>
            <p className={styles.dateLabel}>{currentDest.arrivalDate}</p>
          </div>
        </div>
      )}
    </div>
  );
}
