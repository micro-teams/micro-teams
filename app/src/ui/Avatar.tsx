/*
 * The one avatar, and WeChat's grid of them for a group.
 *
 * <Avatar userId nickname? avatarId? size?> — a rounded square: the person's picture from
 *   cheese-auth when they have one, otherwise a colour chosen by `abs(userId) % 8` and their first
 *   character. The same person keeps the same colour on every screen and device.
 * <MemberGrid members size?> — up to nine faces in one tile; a row that is not full is centred, so
 *   three members read one-over-two and five read two-over-three.
 * colourFor(userId) — that colour, for anything else that has to match it.
 * gridRows(n) — how many faces go on each row of a grid of n.
 *
 * Example: <Avatar userId={7} nickname="alice" avatarId={12} size={metrics.avatarInList} />
 *
 * Nothing else in the app draws a face, so a change to how people look is a change here only.
 */
import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSession } from "../data/session";
import { colors, fonts, metrics } from "./theme";

const PALETTE = ["#4E6EF2", "#12B76A", "#F79009", "#EF4444", "#7C3AED", "#06AED4", "#E64980", "#2DD4BF"];

export function colourFor(userId: number): string {
  return PALETTE[Math.abs(userId) % PALETTE.length];
}

export function Avatar({
  userId,
  nickname,
  avatarId,
  size = metrics.avatarInBubble,
}: {
  userId: number;
  nickname?: string | null;
  avatarId?: number | null;
  size?: number;
}) {
  const { origin } = useSession();
  const [failed, setFailed] = useState(false);
  const label = (nickname ?? "").trim();
  const box = { width: size, height: size, borderRadius: metrics.avatarRadius };

  if (avatarId && !failed) {
    return (
      <Image
        source={{ uri: `${origin}/api/avatars/${avatarId}` }}
        style={box}
        contentFit="cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.fallback, box, { backgroundColor: colourFor(userId) }]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{label ? [...label][0].toUpperCase() : "#"}</Text>
    </View>
  );
}

export function gridRows(n: number): number[] {
  const table: Record<number, number[]> = {
    1: [1],
    2: [2],
    3: [1, 2],
    4: [2, 2],
    5: [2, 3],
    6: [3, 3],
    7: [1, 3, 3],
    8: [2, 3, 3],
  };
  return table[n] ?? (n < 1 ? [1] : [3, 3, 3]);
}

type Member = { userId: number; nickname?: string | null; avatarId?: number | null };

export function MemberGrid({ members, size = metrics.avatarInList }: { members: Member[]; size?: number }) {
  const shown = members.slice(0, 9);
  if (shown.length === 1) return <Avatar {...shown[0]} size={size} />;
  const gap = 1;
  const perRow = shown.length <= 4 ? 2 : 3;
  const tile = (size - 2 * gap - gap * (perRow - 1)) / perRow;
  let i = 0;
  return (
    <View style={[styles.grid, { width: size, height: size, padding: gap }]}>
      {gridRows(shown.length).map((count, r) => (
        <View key={r} style={[styles.gridRow, { marginTop: r === 0 ? 0 : gap, gap }]}>
          {Array.from({ length: count }, () => {
            const m = shown[i++];
            return <Avatar key={m.userId} {...m} size={tile} />;
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: "center", justifyContent: "center" },
  initial: { color: "#fff", fontWeight: "600", fontFamily: fonts.mono },
  grid: { backgroundColor: colors.hover, borderRadius: metrics.avatarRadius, justifyContent: "center" },
  gridRow: { flexDirection: "row", justifyContent: "center" },
});
