'use client';
import LeafletGeorefMap, { ImageItem } from "@/components/LeafletGeorefMap";
import styles from "./page.module.scss";
import { useMemo } from "react";
import dynamic from "next/dynamic";

export default function Home() {
    const sample: ImageItem[] = [
        { name: 'PXL_20250711_201855449.jpg',path:"/", timestamp: '2025-08-17T13:00:00Z', coords: { lat: 52.5208, lng: 13.4095 } },
        { name: '_DSC3432.jpg',path:"/", timestamp: '2025-08-17T14:00:00Z' },
        { name: 'PXL_20250711_093617121.jpg',path:"/", timestamp: '2025-08-17T15:00:00Z', coords: { lat: 52.5300, lng: 13.4200 } },
    ];
    const Map = useMemo(()=>dynamic(
        ()  => import("@/components/LeafletGeorefMap"),
        {
            ssr: false,
            loading: () => <div className={styles.loadingbox}><p className={styles.loadinginfo}>Map is loading...</p></div>
        }
    ),[]);
    return (
        <div>
            <Map images={sample} />
        </div>
    );
}
