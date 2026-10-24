export type BountyDetails = {
  owner: string;
  projectId: string;
  name: string;
  details: string;
  updatedAt: number;
};

const storageKey = "blockpatch:bounty-details";

function readAll(): BountyDetails[] {
  const stored = window.localStorage.getItem(storageKey);
  if (!stored) return [];

  const data: unknown = JSON.parse(stored);
  if (!Array.isArray(data)) throw new Error("Saved bounty details have an invalid format.");

  return data.filter(
    (item): item is BountyDetails =>
      typeof item === "object" &&
      item !== null &&
      "owner" in item &&
      typeof item.owner === "string" &&
      "projectId" in item &&
      typeof item.projectId === "string" &&
      "name" in item &&
      typeof item.name === "string" &&
      "details" in item &&
      typeof item.details === "string" &&
      "updatedAt" in item &&
      typeof item.updatedAt === "number",
  );
}

export function getBountyDetails(owner: string): BountyDetails[] {
  return readAll().filter((item) => item.owner.toLowerCase() === owner.toLowerCase());
}

export function saveBountyDetails(details: BountyDetails): void {
  const existing = readAll().filter(
    (item) =>
      item.owner.toLowerCase() !== details.owner.toLowerCase() ||
      item.projectId.toLowerCase() !== details.projectId.toLowerCase(),
  );
  window.localStorage.setItem(storageKey, JSON.stringify([...existing, details]));
}
