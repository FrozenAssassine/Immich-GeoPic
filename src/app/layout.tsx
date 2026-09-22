import { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Immich GeoPic",
    description: "Georeference your Immich photos with modern map tools, track interpolation, and batch coordinate fixing.",
    keywords: ["immich", "geopic", "image georeferencing", "georeference", "geotagging", "map", "exif", "gps"],
    openGraph: {
        title: "Immich GeoPic",
        description: "Georeference your Immich photos with modern map tools, track interpolation, and batch coordinate fixing.",
    },
    twitter: {
        title: "Immich GeoPic",
        description: "Georeference your Immich photos with modern map tools, track interpolation, and batch coordinate fixing.",
    }
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <body>
                {children}
            </body>
        </html>
    );
}
