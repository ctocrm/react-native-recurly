/**
 * Password input with a show/hide eye toggle (user request 2026-09-15):
 * everyone — old humans and automation alike — needs to SEE what was typed
 * to know it is right. Eye = visible text, crossed eye = hidden.
 */
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";

export function PasswordInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <View className="auth-input flex-row items-center">
      <TextInput
        className="flex-1 text-primary"
        value={props.value}
        onChangeText={props.onChange}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={props.autoFocus ?? false}
      />
      <Pressable
        accessibilityLabel={visible ? "Hide password" : "Show password"}
        onPress={() => setVisible(!visible)}
        hitSlop={8}
      >
        <Feather
          name={visible ? "eye-off" : "eye"}
          size={20}
          color="#8b8b8b"
        />
      </Pressable>
    </View>
  );
}
