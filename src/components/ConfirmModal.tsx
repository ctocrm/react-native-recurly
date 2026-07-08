import React from "react";
import { Modal, Pressable, Text, View } from "react-native";

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal = ({
  visible,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) => {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <Pressable className="flex-1 bg-black/50" onPress={onCancel}>
        <Pressable
          className="mt-auto rounded-t-3xl bg-background p-5"
          onPress={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <View className="mb-4 items-center">
            <View className="h-1 w-12 rounded-full bg-muted-foreground/30" />
          </View>

          {/* Title */}
          <Text className="mb-2 text-xl font-sans-bold text-primary">
            {title}
          </Text>

          {/* Message */}
          <Text className="mb-6 text-sm font-sans-medium leading-5 text-muted-foreground">
            {message}
          </Text>

          {/* Confirm */}
          <Pressable
            className={`mb-3 items-center rounded-2xl py-4 ${
              destructive ? "bg-destructive" : "bg-accent"
            }`}
            onPress={onConfirm}
          >
            <Text className="text-base font-sans-bold text-white">
              {confirmLabel}
            </Text>
          </Pressable>

          {/* Cancel */}
          <Pressable
            className="items-center rounded-2xl bg-muted py-4"
            onPress={onCancel}
          >
            <Text className="text-base font-sans-bold text-primary">
              {cancelLabel}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default ConfirmModal;
