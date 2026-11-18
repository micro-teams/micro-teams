/*
 * The icons the icon font does not have: Material's outlined variants, drawn from their paths.
 *
 * <AddCommentOutlined size? color? /> — "new chat", hollow, as the previous client drew it.
 *
 * Example: <AddCommentOutlined size={22} color={colors.ink} />
 */
import Svg, { Path } from "react-native-svg";

export function AddCommentOutlined({ size = 24, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M22 4c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4zm-2 13.17L18.83 16H4V4h16v13.17zM13 5h-2v4H7v2h4v4h2v-4h4V9h-4V5z"
      />
    </Svg>
  );
}
