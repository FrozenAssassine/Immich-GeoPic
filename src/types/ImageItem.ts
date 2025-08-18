export type ImageItem = {
    name: string;
    path: string;
    timestamp: string; // ISO 8601 or any format parsable by Date
    coords?: {
        lat: number;
        lng: number;
    };
};