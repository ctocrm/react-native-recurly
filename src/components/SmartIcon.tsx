import { Image } from "expo-image";
import { View } from "react-native";
import { SvgXml } from "react-native-svg";

/**
 * Renders a cached icon data URI. React Native's Image cannot decode SVG, so
 * SVG payloads (simple-icons etc.) are decoded and drawn with react-native-svg;
 * anything else goes through expo-image as before.
 */
function base64ToSvgText(base64: string): string | null {
  try {
    const binary = global.atob(base64);
    let text = "";
    for (let i = 0; i < binary.length; i++) text += binary[i];
    return text.includes("<svg") ? text : null;
  } catch {
    return null;
  }
}

export function SmartIcon({
  uri,
  format,
  className,
}: {
  uri: string;
  format?: string | null;
  className?: string;
}) {
  const isSvg = format === "svg" || uri.startsWith("data:image/svg");
  if (isSvg) {
    const commaIdx = uri.indexOf(",");
    const b64 = commaIdx >= 0 ? uri.slice(commaIdx + 1) : uri;
    const xml = base64ToSvgText(b64);
    if (xml) {
      return (
        <View className={className}>
          <SvgXml xml={xml} width="100%" height="100%" />
        </View>
      );
    }
  }
  return <Image source={{ uri }} className={className} contentFit="contain" />;
}
