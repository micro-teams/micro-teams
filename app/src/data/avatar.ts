/*
 * Changing a face: your own, or an agent's.
 *
 * useChangePicture() → { change(whose), changing } — whose is "me" or an agent's user id. change
 *   asks for a picture (the system's photo picker, cropped square), uploads it to cheese-auth as
 *   the signed-in person, and points the profile at it: your own through cheese-auth (the whole
 *   profile, or the rest of it is blanked), an agent's through the backend, which makes the change
 *   as the agent — cheese-auth lets a user write only their own profile. Resolves false when the
 *   picker was dismissed; rejects with what refused. changing is whose change is in flight.
 *
 * Example: const { change, changing } = useChangePicture(); await change(agent.userId);
 */
import { useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import * as auth from "../api/auth";
import { isWeb } from "../platform/platform";
import { useSession } from "./session";

export function useChangePicture() {
  const { origin, token, user, mt, presence, setMyAvatar } = useSession();
  const queries = useQueryClient();
  const [changing, setChanging] = useState<"me" | number | null>(null);

  const change = async (whose: "me" | number): Promise<boolean> => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset) return false;
    const bearer = token();
    if (!bearer || !user) throw new Error("signed out");
    setChanging(whose);
    try {
      const picture: auth.Picture = {
        uri: asset.uri,
        name: asset.fileName ?? "avatar.jpg",
        type: asset.mimeType ?? "image/jpeg",
        // A browser's picker hands back a blob: URL; the upload needs the bytes themselves.
        blob: isWeb ? await (await fetch(asset.uri)).blob() : undefined,
      };
      const avatarId = await auth.uploadAvatar(origin, bearer, picture);
      if (whose === "me") {
        await auth.updateProfile(origin, bearer, user.id, { nickname: user.nickname, intro: user.intro ?? "", avatarId });
        setMyAvatar(avatarId);
      } else {
        await mt!.PUT("/agent/{userId}/avatar", { params: { path: { userId: whose } }, body: { avatarId } });
        await queries.invalidateQueries({ queryKey: ["fleet"] });
        presence.refresh();
      }
      return true;
    } finally {
      setChanging(null);
    }
  };

  return { change, changing };
}
