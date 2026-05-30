import { NextRequest } from "next/server";
import { loadJson } from "../api-helper";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawName = searchParams.get("name");
    if (!rawName) {
      return new Response("Missing name parameter", { status: 400 });
    }

    const name = rawName.replace(/\.exe$/i, "").replace(/-\d+$/, "").toLowerCase();
    const cache = loadJson("icon_cache.json");
    const dataBase64 = cache[name];

    if (dataBase64 && dataBase64 !== "NO_ICON") {
      const buffer = Buffer.from(dataBase64, "base64");
      return new Response(buffer, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return new Response("Icon not found", { status: 404 });
  } catch (err) {
    console.error("ERROR in api/icon:", err);
    return new Response("Error retrieving icon", { status: 500 });
  }
}
