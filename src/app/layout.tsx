import { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "GeoPic",
    description: "GeoPic is a tool that helps you to add coordinates to your images. It uses the EXIF metadata of your images to estimate their location and allows you to adjust the position on a map.",
    keywords: ["geopic","image georeferencing","georeference","geotagging","geotag","leaflet","map","exif","exif metadata","coordinates","location"],
    openGraph: {
        title: "GeoPic",
        description: "GeoPic is a tool that helps you to add coordinates to your images. It uses the EXIF metadata of your images to estimate their location and allows you to adjust the position on a map.",
    },
    twitter: {
        title: "GeoPic",
        description: "GeoPic is a tool that helps you to add coordinates to your images. It uses the EXIF metadata of your images to estimate their location and allows you to adjust the position on a map.",
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
