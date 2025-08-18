import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import exifr from "exifr";
import { exiftool } from "exiftool-vendored";
import { ImageItem } from "@/types/ImageItem";
import { spawn } from "child_process";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

function isImage(file: string): boolean {
    return IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase());
}

export async function GET(req: NextRequest) {
    async function walk(dir: string, subPath: string = ""): Promise<ImageItem[]> {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        const results: ImageItem[] = [];

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relPath = path.join(subPath, entry.name);

            if (entry.isDirectory()) {
                results.push(...(await walk(fullPath, relPath)));
            } else if (entry.isFile() && isImage(entry.name)) {
                // Try reading EXIF metadata
                let timestamp: string;
                let coords: { lat: number; lng: number } | undefined;

                try {
                    const exif = await exifr.parse(fullPath, { gps: true });
                    if (exif?.DateTimeOriginal) {
                        timestamp = new Date(exif.DateTimeOriginal).toISOString();
                    } else {
                        // fallback to file modification time
                        const stat = fs.statSync(fullPath);
                        timestamp = stat.mtime.toISOString();
                    }

                    if (exif?.latitude && exif?.longitude) {
                        coords = { lat: exif.latitude, lng: exif.longitude };
                    }
                } catch (err) {
                    // fallback if no EXIF readable
                    const stat = fs.statSync(fullPath);
                    timestamp = stat.mtime.toISOString();
                }

                results.push({
                    name: entry.name,
                    path: "/" + subPath.replace(/\\/g, "/").replace(entry.name, ""),
                    timestamp,
                    coords,
                });
            }
        }
        return results;
    }

    return NextResponse.json({
        images: await walk('public', ""),
        success: true,
    });
}

export async function POST(req: NextRequest) {
    var imageitem = await req.json() as ImageItem;
    if (!imageitem || !imageitem.name || !imageitem.path || !imageitem.timestamp || !imageitem.coords) {
        console.error("Invalid iamge item");
        return NextResponse.json({ error: "Invalid image item" }, { status: 400 });
    }

    // Build absolute path to the image inside /public
    const fullImagePath = path.join(process.cwd(), "public", imageitem.path, imageitem.name);

    // Determine hemisphere refs
    const latRef = imageitem.coords?.lat >= 0 ? "N" : "S";
    const lngRef = imageitem.coords?.lng >= 0 ? "E" : "W";

    try {
        const output = await new Promise<string>((resolve, reject) => {
            // exiftool arguments
            const args = [
                `-GPSLatitude=${Math.abs(imageitem.coords?.lat as number)}`,
                `-GPSLatitudeRef=${latRef}`,
                `-GPSLongitude=${Math.abs(imageitem.coords?.lng as number)}`,
                `-GPSLongitudeRef=${lngRef}`,
                "-overwrite_original",
                fullImagePath,
            ];

            const proc = spawn("exiftool", args);

            let stdout = "";
            let stderr = "";

            proc.stdout.on("data", (data) => (stdout += data.toString()));
            proc.stderr.on("data", (data) => (stderr += data.toString()));

            proc.on("close", (code) => {
                if (code === 0) resolve(stdout.trim());
                else reject(new Error(stderr || `Exiftool exited with code ${code}`));
            });
        });

        return NextResponse.json({ success: true, output });
    } catch (err: any) {
        console.error(err);
        return NextResponse.json({ error: err.Message }, { status: 400 });
    }
}

async function writeImageMetadata(image: ImageItem) {
    // full path in /public
    const fullPath = path.join(process.cwd(), "public", image.path, image.name);

    const tags: any = {};

    // set date
    if (image.timestamp) {
        const d = new Date(image.timestamp);
        // exiftool expects YYYY:MM:DD HH:MM:SS format
        const formatted = d.toISOString().replace(/T/, " ").replace(/\..+/, "").replace(/-/g, ":");
        tags.DateTimeOriginal = formatted;
        tags.CreateDate = formatted;
        tags.ModifyDate = formatted;
    }

    // set GPS
    if (image.coords) {
        tags.GPSLatitude = image.coords.lat;
        tags.GPSLongitude = image.coords.lng;
        tags.GPSLatitudeRef = "N";
        tags.GPSLongitudeRef = "E";
    }

    // write changes
    await exiftool.write(fullPath, tags);

    // exiftool process keeps running; close when app exits
}