'use client';
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { LatLng, LatLngBounds, LatLngExpression, LeafletMouseEvent } from "leaflet";
import styles from "./LeafletGeorefMap.module.scss";
import Control from 'react-leaflet-custom-control'
import "leaflet/dist/leaflet.css";
import "leaflet-defaulticon-compatibility"
import "leaflet-defaulticon-compatibility/dist/leaflet-defaulticon-compatibility.css"
import { MapContainer, useMapEvents, TileLayer, CircleMarker, Polyline, Rectangle, useMap } from "react-leaflet";
import { ImageItem } from "@/types/ImageItem";
import L from "leaflet";

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

function randomOffset(scale = 0.05) {
    return (Math.random() - 0.5) * scale;
}

function computeEstimatedPositions(items: ImageItem[]): Array<ImageItem & { estimated?: boolean; estCoords?: { lat: number; lng: number } }> {
    if (!Array.isArray(items)) return [];

    // clone and sort by time ascending
    const sorted = items
        .map((it) => ({ ...it }))
        .sort((a, b) => parseTimeMs(a.timestamp) - parseTimeMs(b.timestamp));

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
            out[i].estCoords = { lat: est.lat, lng: est.lng };
        } else if (prevIndex !== -1) {
            // Only previous available: assign previous coords (reasonable fallback)
            out[i].estimated = true;
            const base = out[prevIndex].coords as { lat: number; lng: number };
            out[i].estCoords = { lat: base.lat + randomOffset(), lng: base.lng + randomOffset() };
        } else if (nextIndex !== -1) {
            // Only next available: assign next coords
            out[i].estimated = true;
            const base = out[nextIndex].coords as { lat: number; lng: number };
            out[i].estCoords = { lat: base.lat + randomOffset(), lng: base.lng + randomOffset() };
        } else {
            // no georef at all -> place around 0|0 with random offset
            out[i].estimated = true;
            out[i].estCoords = { lat: randomOffset(0.2), lng: randomOffset(0.2) };
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

    const [bounds, setBounds] = useState<LatLngBounds|null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [startLatLng, setStartLatLng] = useState<LatLng|null>(null);
    const shiftPressed = useRef(false);

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

    function fixMarkers(){
        let estimatedFix = computed.filter(i=>i.estimated ? bounds?.contains([i.estCoords?.lat as number, i.estCoords?.lng as number]) : false)
        estimatedFix.forEach(i=>{
            fetch('/api',{method: 'POST', body: JSON.stringify({...i, coords: { lat: i.estCoords?.lat, lng: i.estCoords?.lng }})});
        });
        console.log(estimatedFix);
        console.log(images);
        setImages(prev =>
            prev.map(img => estimatedFix.find(i=>i.name===img.name && i.path===img.path) ?? img)
        );
    }

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

    function RectangleDrawer() {
        const map = useMap();

        useMapEvents({
            keydown(e) {
                if (e.originalEvent.key === "Shift") {
                    shiftPressed.current = true;
                }
            },
            keyup(e) {
                if (e.originalEvent.key === "Shift") {
                    shiftPressed.current = false;
                }
            },
            mousedown(e) {
                if (shiftPressed.current) {
                    setIsDrawing(true);
                    setStartLatLng(e.latlng);
                    setBounds(null);
                    map.dragging.disable();
                }
            },
            mousemove(e) {
                if (isDrawing && startLatLng) {
                    const newBounds = L.latLngBounds(startLatLng, e.latlng);
                    setBounds(newBounds);
                }
            },
            mouseup(e) {
                if (isDrawing && startLatLng) {
                    const finalBounds = L.latLngBounds(startLatLng, e.latlng);
                    setBounds(finalBounds);
                }
                setIsDrawing(false);
                setStartLatLng(null);
                map.dragging.enable();
            },
        });

        return bounds ? (
            <Rectangle bounds={bounds} pathOptions={{ color: "purple" }} />
        ) : null;
    }

    return (
        <div className={styles.mapcontainer}>
            <MapContainer center={center} zoom={zoom} style={{ width: "100%", height: "100%" }} boxZoom={false}>
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

                <RectangleDrawer />

                <Control position="topright">
                    <div className={styles.infopanel}>
                        <div style={{ display: panelVisibility ? 'none' : 'block' }}>
                            <h1>GeoPic</h1><br/>
                            <h2>Tutorial</h2><br/>
                            <ul>
                                <li>Paste all images into the "public" directory. Reload the page.</li>
                                <li>Click any marker to view the image details.</li>
                                <li>Click "Relocate" and press somewhere on the map to relocate the GPS posiion of the image.</li>
                                <li>Click "Remove coordinates" to remove the coordinates of an image.</li>
                                <li>Hold "Shift" and click/drag your mouse to make a selection. Options appear at the bottom of this window.</li>
                                <li>Click while holdng "Shift" to remove the selection.</li>
                            </ul>
                        </div>
                        <div className={styles.panelimageholder} style={{ display: panelVisibility ? 'block' : 'none' }}>
                            <img src={currentImage.path + currentImage.name == '' ? undefined : currentImage.path + currentImage.name} className={styles.panelimage} />
                        </div>
                        <div className={styles.paneltext} style={{ display: panelVisibility ? 'block' : 'none' }}>
                            <div>Name: {currentImage.name}</div>
                            <div>Path: {currentImage.path}</div>
                            <div>Time: {new Date(currentImage.timestamp).toLocaleString()}</div>
                            {currentImage.coords && <div>Coords: {currentImage.coords.lat.toFixed(6)}, {currentImage.coords.lng.toFixed(6)}</div>}
                        </div>
                        <div style={{ display: panelVisibility ? 'block' : 'none' }}>
                            <button onClick={()=>setRelocating(true)} className={styles.panelbutton}>Relocate current marker</button>
                            <button onClick={()=>fixMarkers()} className={styles.panelbutton}>Fix selected markers</button>
                        </div>
                    </div>
                </Control>
            </MapContainer>
        </div>
    );
}