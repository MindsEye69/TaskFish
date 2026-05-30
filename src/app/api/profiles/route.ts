import { NextResponse } from "next/server";
import { createProfileId, ensureProfilesData, findProfile, normalizeProfileRules } from "@/lib/profiles";
import { loadJson, saveJson } from "../api-helper";

export const dynamic = "force-dynamic";

export async function GET() {
  const profiles = ensureProfilesData(loadJson("profiles.json"));
  return NextResponse.json({ profiles });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const profiles = ensureProfilesData(loadJson("profiles.json"));

    if (body.action === "apply") {
      const profile = findProfile(profiles, String(body.profileId || ""));
      if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

      const rules = normalizeProfileRules(profile.rules);
      saveJson("rules.json", rules);
      const nextProfiles = { ...profiles, activeProfileId: profile.id };
      saveJson("profiles.json", nextProfiles);
      return NextResponse.json({ ok: true, rules, profiles: nextProfiles });
    }

    if (body.action === "save") {
      const name = String(body.name || "").trim();
      if (!name) return NextResponse.json({ error: "Missing profile name" }, { status: 400 });

      const id = createProfileId(name);
      const savedProfile = {
        id,
        name,
        description: `${Object.keys(body.rules || {}).length} saved rule(s).`,
        rules: normalizeProfileRules(body.rules),
        updatedAt: Date.now(),
      };
      const customProfiles = profiles.profiles.filter(profile => profile.builtIn || profile.id !== id);
      const nextProfiles = {
        activeProfileId: id,
        profiles: [...customProfiles, savedProfile],
      };
      saveJson("profiles.json", nextProfiles);
      saveJson("rules.json", savedProfile.rules);
      return NextResponse.json({ ok: true, profiles: nextProfiles });
    }

    return NextResponse.json({ error: "Unsupported profile action" }, { status: 400 });
  } catch (err) {
    console.error("ERROR in POST api/profiles:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
