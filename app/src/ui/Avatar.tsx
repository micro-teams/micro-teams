/*
 * The one avatar, and WeChat's grid of them for a group.
 *
 * <Avatar userId nickname? avatarId? size? onChangePicture? changing?> — a rounded square: the
 *   person's picture from cheese-auth when they have one, otherwise a colour chosen by
 *   `abs(userId) % 8` and their first character. The same person keeps the same colour on every
 *   screen and device. Every avatar asks the presence registry about its id: an agent that is
 *   working gets a pulsing violet ring, and an agent's face is always tappable, everywhere it is
 *   drawn — the tap opens its live screen over whatever is on screen, or says why it cannot.
 *   onChangePicture adds a camera badge (your own face, an agent's page) that changes the picture.
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
import { useEffect, useState } from "react";
import { MaterialIcons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { usePresence } from "../data/presence";
import { useSession } from "../data/session";
import { useNav } from "../nav/NavProvider";
import { colors, fonts, metrics } from "./theme";
import { useToast } from "./Toast";

const PALETTE = ["#4E6EF2", "#12B76A", "#F79009", "#EF4444", "#7C3AED", "#06AED4", "#E64980", "#2DD4BF"];

export function colourFor(userId: number): string {
  return PALETTE[Math.abs(userId) % PALETTE.length];
}

/** The ring around a working agent: 0.35 → 1 opacity and 1 → 1.08 scale, out and back, 1.6 s. */
function Ring({ size }: { size: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withRepeat(withTiming(1, { duration: 1600 }), -1, true);
    return () => cancelAnimation(t);
  }, [t]);
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * t.value, transform: [{ scale: 1 + 0.08 * t.value }] }));
  const inset = size * 0.18;
  return (
    <Animated.View
      testID="working-ring"
      pointerEvents="none"
      style={[styles.ring, { top: -inset, left: -inset, right: -inset, bottom: -inset, borderRadius: size }, style]}
    />
  );
}

function Picture({ userId, label, avatarId, size }: { userId: number; label: string; avatarId?: number | null; size: number }) {
  const { origin } = useSession();
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: metrics.avatarRadius };
  if (avatarId && !failed) {
    return <Image source={{ uri: `${origin}/api/avatars/${avatarId}` }} style={box} contentFit="cover" onError={() => setFailed(true)} />;
  }
  return (
    <View style={[styles.fallback, box, { backgroundColor: colourFor(userId) }]}>
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{label ? [...label][0].toUpperCase() : "#"}</Text>
    </View>
  );
}

export function Avatar({
  userId,
  nickname,
  avatarId,
  size = metrics.avatarInBubble,
  onChangePicture,
  changing,
}: {
  userId: number;
  nickname?: string | null;
  avatarId?: number | null;
  size?: number;
  /** Where a face may be changed (your own, an agent's page): a camera badge that does it. */
  onChangePicture?: () => void;
  changing?: boolean;
}) {
  const { agent, working, watchable } = usePresence(userId);
  const toast = useToast();
  const { push } = useNav();
  const label = (nickname ?? agent?.nickname ?? "").trim();
  const name = label || `#${userId}`;
  const picture = <Picture userId={userId} label={label} avatarId={avatarId ?? agent?.avatarId} size={size} />;
  return (
    <View style={{ width: size, height: size }}>
      {working && <Ring size={size} />}
      {agent ? (
        // An agent's face is always its live screen, wherever it is drawn.
        <Pressable
          testID={`agent-avatar-${userId}`}
          accessibilityLabel={watchable ? `${name} · 点击查看现场` : agent.online ? `${name} · 现场暂不可用` : `${name} · 离线`}
          onPress={() =>
            watchable ? push("screen", "overlay", { sessionId: agent.sid }) : toast(agent.online ? `「${name}」的现场暂不可用` : `「${name}」当前离线，无法查看现场`)
          }
        >
          {picture}
        </Pressable>
      ) : (
        picture
      )}
      {onChangePicture ? (
        // Always visible rather than on hover: a phone has no hover, and an affordance nobody can find is not one.
        <Pressable testID="change-avatar" accessibilityLabel="change picture" onPress={onChangePicture} disabled={changing} hitSlop={6} style={styles.badge}>
          {changing ? <ActivityIndicator size="small" color={colors.page} /> : <MaterialIcons name="photo-camera" size={14} color={colors.page} />}
        </Pressable>
      ) : null}
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
  ring: { position: "absolute", borderWidth: 2, borderColor: colors.working },
  badge: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brand,
    borderWidth: 2,
    borderColor: colors.page,
    alignItems: "center",
    justifyContent: "center",
  },
  grid: { backgroundColor: colors.hover, borderRadius: metrics.avatarRadius, justifyContent: "center" },
  gridRow: { flexDirection: "row", justifyContent: "center" },
});
