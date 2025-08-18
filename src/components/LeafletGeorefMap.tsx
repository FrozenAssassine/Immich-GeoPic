'use client';
import React, { useEffect, useMemo, useState } from "react";
import type { LatLngExpression, LeafletMouseEvent } from "leaflet";
import styles from "./LeafletGeorefMap.module.scss";
import Control from 'react-leaflet-custom-control'
import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility"
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css"

// We import react-leaflet types dynamically at runtime (component exported as NoSSR below)
import { MapContainer, useMapEvents, TileLayer, CircleMarker, Polyline } from "react-leaflet";
import { ImageItem } from "@/types/ImageItem";

type Props = {
    images: ImageItem[];
    // optional initial center and zoom
    center?: LatLngExpression;
    zoom?: number;
};

function parseTimeMs(timestamp: string): number {
    const t = Date.parse(timestamp);
    if (Number.isNaN(t)) {
        throw new Error(`Unparsable timestamp: ${timestamp}`);
    }
    return t;
}

function interpolate(a: number, b: number, ratio: number): number {
    return a + (b - a) * ratio;
}

function interpolateCoords(a: { lat: number; lng: number }, b: { lat: number; lng: number }, ratio: number) {
    return {
        lat: interpolate(a.lat, b.lat, ratio),
        lng: interpolate(a.lng, b.lng, ratio),
    };
}

function computeEstimatedPositions(items: ImageItem[]): Array<ImageItem & { estimated?: boolean; estCoords?: { lat: number; lng: number } }> {
    if (!Array.isArray(items)) return [];

    // clone and sort by time ascending
    const sorted = items
        .map((it) => ({ ...it }))
        .sort((a, b) => parseTimeMs(a.timestamp) - parseTimeMs(b.timestamp));

    // collect indices of georeferenced (greens)
    const geoIndices: number[] = [];
    for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].coords) geoIndices.push(i);
    }

    const out: Array<ImageItem & { estimated?: boolean; estCoords?: { lat: number; lng: number } }> = sorted.map((it) => ({ ...it }));

    for (let i = 0; i < out.length; i++) {
        if (out[i].coords) continue; // already georeferenced

        // find previous georef index < i
        let prevIndex = -1;
        for (let j = i - 1; j >= 0; j--) {
            if (out[j].coords) {
                prevIndex = j;
                break;
            }
        }
        // find next georef index > i
        let nextIndex = -1;
        for (let j = i + 1; j < out.length; j++) {
            if (out[j].coords) {
                nextIndex = j;
                break;
            }
        }

        if (prevIndex !== -1 && nextIndex !== -1) {
            const tPrev = parseTimeMs(out[prevIndex].timestamp);
            const tNext = parseTimeMs(out[nextIndex].timestamp);
            const tCur = parseTimeMs(out[i].timestamp);
            const ratio = (tCur - tPrev) / (tNext - tPrev);
            const est = interpolateCoords(out[prevIndex].coords as { lat: number; lng: number }, out[nextIndex].coords as { lat: number; lng: number }, ratio);
            out[i].estimated = true;
            out[i].estCoords = est;
        } else if (prevIndex !== -1) {
            // Only previous available: assign previous coords (reasonable fallback)
            out[i].estimated = true;
            out[i].estCoords = { ... (out[prevIndex].coords as { lat: number; lng: number }) };
        } else if (nextIndex !== -1) {
            // Only next available: assign next coords
            out[i].estimated = true;
            out[i].estCoords = { ... (out[nextIndex].coords as { lat: number; lng: number }) };
        } else {
            // no georef at all -> leave undefined
            out[i].estimated = false;
        }
    }

    return out;
}

export default function LeafletGeorefMap(props: Props) {
    const [currentImage,setCurrentImage] = useState<ImageItem>({ name: '', path: '', timestamp: '', coords: undefined });
    const [images, setImages] = useState<ImageItem[]>(props.images);
    const computed = useMemo(() => computeEstimatedPositions(images), [images]);
    const [panelVisibility,setPanelVisibility] = useState(false);
    const [relocating,setRelocating] = useState(false);

    useEffect(() => {
        setImages(prev =>
            prev.map(img =>
                img.name === currentImage.name && img.path === currentImage.path
                    ? currentImage
                    : img
            )
        );
    }, [currentImage]);

    const center: LatLngExpression = props.center ?? (() => {
        const firstGeo = computed.find((i) => i.coords || i.estCoords);
        if (firstGeo) return (firstGeo.coords ?? firstGeo.estCoords) as LatLngExpression;
        return [0, 0];
    })();

    const zoom = props.zoom ?? 13;

    const georefPositions: LatLngExpression[] = computed.filter((i) => i.coords).map((i) => [i.coords!.lat, i.coords!.lng]);

    // https://dev.to/digitalpollution/a-friendly-guide-to-using-react-leaflet-with-react-42k7
    const MapEventsHandler = ( { handleMapClick } : { handleMapClick: (e: LeafletMouseEvent)=>void }) => {
        useMapEvents({
            click: (e) => handleMapClick(e),
        });
        return null;
    };

    function handleMapClick(e: LeafletMouseEvent) {
        const { lat, lng } = e.latlng;
        if(relocating){
            setCurrentImage((prev) => ({
                ...prev,
                coords: { lat, lng }
            }));
            setRelocating(false);
            fetch('/api',{method: 'POST', body: JSON.stringify({...currentImage,coords: { lat, lng }})});
        }
    };

    return (
        <div className={styles.mapcontainer}>
            <MapContainer center={center} zoom={zoom} style={{ width: "100%", height: "100%" }}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {georefPositions.length >= 2 && (
                    <Polyline positions={georefPositions} />
                )}

                {computed.map((it, idx) => {
                    if (it.coords) {
                        return (
                            <CircleMarker
                                key={idx}
                                center={[it.coords.lat, it.coords.lng]}
                                radius={8}
                                pathOptions={{ color: "green" }}
                                eventHandlers={{
                                    click: (e) => { setCurrentImage(it); setPanelVisibility(true); }
                                }} />
                        );
                    } else if (it.estimated && it.estCoords) {
                        return (
                            <CircleMarker
                                key={idx}
                                center={[it.estCoords.lat, it.estCoords.lng]}
                                radius={8}
                                pathOptions={{ color: "red" }}
                                eventHandlers={{
                                    click: (e) => { setCurrentImage(it); setPanelVisibility(true); }
                                }} />
                        );
                    } else {
                        return null;
                    }
                })}

                <MapEventsHandler handleMapClick={handleMapClick} />

                <Control position="topright">
                    <div className={styles.infopanel} style={{ display: panelVisibility ? 'flex' : 'none' }}>
                        <div className={styles.panelimageholder}>
                            <img src={currentImage.path + currentImage.name == '' ? undefined : currentImage.path + currentImage.name} className={styles.panelimage} />
                        </div>
                        <div className={styles.paneltext}>
                            <div>Name: {currentImage.name}</div>
                            <div>Path: {currentImage.path}</div>
                            <div>Time: {new Date(currentImage.timestamp).toLocaleString()}</div>
                            {currentImage.coords && <div>Coords: {currentImage.coords.lat.toFixed(6)}, {currentImage.coords.lng.toFixed(6)}</div>}
                        </div>
                        <div>
                            <button onClick={()=>setRelocating(true)} className={styles.panelbutton}>Relocate</button>
                        </div>
                    </div>
                </Control>
            </MapContainer>
        </div>
    );
}