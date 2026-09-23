import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getDataDir } from "./settings";
import { CreateVirtualGroupInput, UpdateVirtualGroupInput, VirtualGroup } from "@/types/VirtualGroup";

function getGroupsDir(userId?: string): string {
  const userKey = userId || "default";
  return path.join(getDataDir(), "groups", userKey);
}

function getGroupsFilePath(userId?: string): string {
  return path.join(getGroupsDir(userId), "groups.json");
}

export async function getUserGroups(userId?: string): Promise<VirtualGroup[]> {
  const filePath = getGroupsFilePath(userId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeUserGroups(userId: string | undefined, groups: VirtualGroup[]): Promise<void> {
  const dir = getGroupsDir(userId);
  const filePath = getGroupsFilePath(userId);
  const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tempPath, JSON.stringify(groups, null, 2), "utf-8");
    await fs.rename(tempPath, filePath);
  } catch (err: unknown) {
    try {
      await fs.unlink(tempPath);
    } catch {
      // ignore
    }

    if (err && typeof err === "object" && "code" in err && err.code === "EACCES") {
      console.error(
        `[GeoPic Groups] Permission denied writing to "${dir}". ` +
        `Ensure the Docker volume is writable by user UID 1001.`
      );
      throw new Error(`Permission denied writing to "${dir}". Please ensure the Docker volume is writable.`);
    }

    throw err;
  }
}

export async function getGroupById(id: string, userId?: string): Promise<VirtualGroup | null> {
  const groups = await getUserGroups(userId);
  return groups.find((g) => g.id === id) || null;
}

export async function createGroup(
  input: CreateVirtualGroupInput,
  userId?: string
): Promise<VirtualGroup> {
  const name = (input.name || "").trim();
  if (!name) {
    throw new Error("Group name is required");
  }

  if (typeof input.lat !== "number" || typeof input.lng !== "number" || Number.isNaN(input.lat) || Number.isNaN(input.lng)) {
    throw new Error("Valid coordinates (latitude and longitude) are required");
  }

  const radius = typeof input.radius === "number" && input.radius >= 0 ? Math.round(input.radius) : 0;
  const directFix = Boolean(input.directFix);

  const newGroup: VirtualGroup = {
    id: `grp_${crypto.randomUUID().slice(0, 8)}`,
    name,
    lat: input.lat,
    lng: input.lng,
    radius,
    directFix,
    createdAt: new Date().toISOString(),
  };

  const groups = await getUserGroups(userId);
  groups.push(newGroup);
  await writeUserGroups(userId, groups);

  return newGroup;
}

export async function updateGroup(
  input: UpdateVirtualGroupInput,
  userId?: string
): Promise<VirtualGroup> {
  const groups = await getUserGroups(userId);
  const index = groups.findIndex((g) => g.id === input.id);
  if (index === -1) {
    throw new Error(`Group with id "${input.id}" not found`);
  }

  const existing = groups[index];
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) {
    throw new Error("Group name cannot be empty");
  }

  const lat = input.lat !== undefined ? input.lat : existing.lat;
  const lng = input.lng !== undefined ? input.lng : existing.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
    throw new Error("Valid coordinates are required");
  }

  const radius = input.radius !== undefined ? Math.max(0, Math.round(input.radius)) : existing.radius;
  const directFix = input.directFix !== undefined ? Boolean(input.directFix) : existing.directFix;

  const updated: VirtualGroup = {
    ...existing,
    name,
    lat,
    lng,
    radius,
    directFix,
  };

  groups[index] = updated;
  await writeUserGroups(userId, groups);

  return updated;
}

export async function deleteGroup(id: string, userId?: string): Promise<VirtualGroup[]> {
  const groups = await getUserGroups(userId);
  const filtered = groups.filter((g) => g.id !== id);
  if (filtered.length === groups.length) {
    throw new Error(`Group with id "${id}" not found`);
  }

  await writeUserGroups(userId, filtered);
  return filtered;
}
