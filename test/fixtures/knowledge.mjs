import { readFileSync } from "node:fs";
export const at = "2026-11-04T12:00:00Z";
export function seed() { return JSON.parse(readFileSync(new URL("../../knowledge/releases/gb-method-2026-11-04.json", import.meta.url), "utf8")); }
export function synthetic() {
  const raw = seed();
  raw.id = "synthetic-test-release";
  raw.shops = [{ id: "synthetic", label: "Synthetic test seller", status: "supported", facts: ["synthetic-student", "synthetic-code"] }];
  raw.facts = [
    { id: "synthetic-student", shop: "synthetic", claim: "SYNTHETIC test eligibility, no real offer", place: "student", source: "https://primary.example.invalid/student", observedAt: "2026-11-03T00:00:00Z", validUntil: "2026-12-01T00:00:00Z", applies: "online", refreshOwner: "Synthetic fixture owner", authority: "primary", status: "needs-step", kind: "student", domain: null, requires: ["verify-student"], references: [] },
    { id: "synthetic-code", shop: "synthetic", claim: "SYNTHETIC untested code; not a usable code", place: "codes", source: "https://third-party.example.invalid/code", observedAt: "2026-11-03T00:00:00Z", validUntil: "2026-12-01T00:00:00Z", applies: "online", refreshOwner: "Synthetic fixture owner", authority: "third-party", status: "untested", kind: "code", domain: null, requires: [], references: [] }
  ];
  raw.rows.find(row => row.place === "student").facts = ["synthetic-student"];
  raw.rows.find(row => row.place === "codes").facts = ["synthetic-code"];
  return raw;
}
