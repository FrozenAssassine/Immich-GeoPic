export interface VirtualGroup {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius: number; // 0 for Marker (single point), > 0 for Area (circular zone in meters)
  directFix: boolean; // true = directly fixed in Immich (Green), false = estimated position (Yellow)
  createdAt: string;
}

export type CreateVirtualGroupInput = Omit<VirtualGroup, "id" | "createdAt">;
export type UpdateVirtualGroupInput = Partial<CreateVirtualGroupInput> & { id: string };

export interface AssignToGroupPhotoItem {
  id: string;
  timestamp: string;
  hasCoords?: boolean;
}

export interface AssignToGroupRequest {
  groupId: string;
  photos: AssignToGroupPhotoItem[];
  applyTo?: "all" | "estimatedOnly";
}

export interface AssignToGroupResponse {
  success: boolean;
  directFix: boolean;
  updatedPhotos: Array<{
    id: string;
    coords?: { lat: number; lng: number } | null;
    estCoords?: { lat: number; lng: number };
  }>;
}
