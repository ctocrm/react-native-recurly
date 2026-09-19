/**
 * Phase O: the muted "no thumbnail" glyph. Replaces the old plus.png card
 * fallback: a card with no icon yet is a MISSING thumbnail, not a plus
 * action. Also used by the Add-mailbox picker rows for providers without a
 * curated brand mark.
 */
import { View } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

export function NoThumbnail({ size = 64 }: { size?: number }) {
  return (
    <View
      className="items-center justify-center rounded-xl border border-border bg-muted"
      style={{ width: size, height: size }}
    >
      <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24">
        <Rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="3"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="2"
          fill="none"
        />
        <Circle
          cx="9"
          cy="9"
          r="1.6"
          fill="rgba(0,0,0,0.35)"
          stroke="none"
        />
        <Path
          d="M5 17.5 9.5 13l3.5 3.5 2.5-2.5L19 17.5"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Line
          x1="4"
          y1="20"
          x2="20"
          y2="4"
          stroke="rgba(0,0,0,0.35)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
