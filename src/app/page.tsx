'use client';
import LeafletGeorefMap from "@/components/LeafletGeorefMap";
import styles from "./page.module.scss";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ImageItem } from "@/types/ImageItem";

export default function Home() {
    const [imgs,setImgs] = useState<ImageItem[]>([]);
    useEffect(()=>{
        fetch('/api').then(res => res.json()).then(data=>setImgs(data.images));
    },[]);
    const Map = useMemo(()=>dynamic(
        ()  => import("@/components/LeafletGeorefMap"),
        {
            ssr: false,
            loading: () => <div className={styles.loadingbox}><p className={styles.loadinginfo}>Map is loading...</p></div>
        }
    ),[]);
    return (
        <div>
            <Map images={imgs} />
        </div>
    );
}
