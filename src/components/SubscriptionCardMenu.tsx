import clsx from "clsx";
import React, { useEffect } from "react";
import {
  ActionSheetIOS,
  Alert,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";

interface SubscriptionCardMenuProps {
  visible: boolean;
  onClose: () => void;
  status?: string;
  onEdit: () => void;
  onMarkActive: () => void;
  onMarkPaused: () => void;
  onMarkCancelled: () => void;
  onDelete: () => void;
  onViewStats: () => void;
}

const SubscriptionCardMenu = ({
  visible,
  onClose,
  status,
  onEdit,
  onMarkActive,
  onMarkPaused,
  onMarkCancelled,
  onDelete,
  onViewStats,
}: SubscriptionCardMenuProps) => {
  const handleDelete = () => {
    Alert.alert(
      "Delete Subscription",
      "Are you sure you want to delete this subscription? This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            onDelete();
            onClose();
          },
        },
      ],
    );
  };

  const showActionSheet = () => {
    const options: string[] = ["View Stats", "Edit"];

    if (status === "cancelled" || status === "paused") {
      options.push("Mark as Active");
    }
    if (status !== "paused") {
      options.push("Mark as Paused");
    }
    if (status !== "cancelled") {
      options.push("Mark as Canceled");
    }

    options.push("Delete");
    const destructiveIndex = options.length - 1;
    options.push("Cancel");
    const cancelIndex = options.length - 1;

    ActionSheetIOS.showActionSheetWithOptions(
      {
        options,
        cancelButtonIndex: cancelIndex,
        destructiveButtonIndex: destructiveIndex,
      },
      (buttonIndex) => {
        if (buttonIndex === cancelIndex) {
          onClose();
          return;
        }

        const selected = options[buttonIndex];
        if (selected === "View Stats") {
          onViewStats();
          onClose();
        } else if (selected === "Edit") {
          onEdit();
          onClose();
        } else if (selected === "Mark as Active") {
          onMarkActive();
          onClose();
        } else if (selected === "Mark as Paused") {
          onMarkPaused();
          onClose();
        } else if (selected === "Mark as Canceled") {
          onMarkCancelled();
          onClose();
        } else if (selected === "Delete") {
          handleDelete();
        } else {
          onClose();
        }
      },
    );
  };

  // Show iOS action sheet when visible changes to true
  useEffect(() => {
    if (Platform.OS === "ios" && visible) {
      showActionSheet();
    }
  }, [visible]);

  // iOS: no UI to render (native action sheet)
  if (Platform.OS === "ios") {
    return null;
  }

  // Android: custom bottom sheet
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/50" onPress={onClose}>
        <Pressable
          className="mt-auto rounded-t-3xl bg-background p-5"
          onPress={(e) => e.stopPropagation()}
        >
          <View className="mb-2 items-center">
            <View className="mb-4 h-1 w-12 rounded-full bg-muted-foreground/30" />
          </View>

          <MenuItem
            label="View Stats"
            onPress={() => {
              onViewStats();
              onClose();
            }}
          />
          <MenuItem
            label="Edit"
            onPress={() => {
              onEdit();
              onClose();
            }}
          />

          {(status === "cancelled" || status === "paused") && (
            <MenuItem
              label="Mark as Active"
              onPress={() => {
                onMarkActive();
                onClose();
              }}
            />
          )}
          {status !== "paused" && (
            <MenuItem
              label="Mark as Paused"
              onPress={() => {
                onMarkPaused();
                onClose();
              }}
            />
          )}
          {status !== "cancelled" && (
            <MenuItem
              label="Mark as Canceled"
              onPress={() => {
                onMarkCancelled();
                onClose();
              }}
            />
          )}

          <MenuItem
            label="Delete"
            destructive
            onPress={() => {
              handleDelete();
            }}
          />

          <Pressable
            className="mt-4 items-center rounded-2xl bg-muted py-4"
            onPress={onClose}
          >
            <Text className="font-sans-bold text-primary">Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

interface MenuItemProps {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

const MenuItem = ({ label, destructive, onPress }: MenuItemProps) => (
  <Pressable className="rounded-2xl py-4" onPress={onPress}>
    <Text
      className={clsx(
        "text-center text-base font-sans-semibold",
        destructive ? "text-destructive" : "text-primary",
      )}
    >
      {label}
    </Text>
  </Pressable>
);

export default SubscriptionCardMenu;
