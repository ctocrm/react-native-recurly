import images from "@/constants/images";
import { useSubscriptions } from "@/src/context/SubscriptionContext";
import { useUser } from "@clerk/expo";
import React from "react";
import { Image, Modal, Pressable, Switch, Text, View } from "react-native";

interface UserSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const UserSettingsModal = ({ visible, onClose }: UserSettingsModalProps) => {
  const { user } = useUser();
  const { notificationEnabled, setNotificationEnabled } = useSubscriptions();

  const displayName =
    user?.firstName ||
    user?.fullName ||
    user?.emailAddresses[0]?.emailAddress ||
    "User";
  const email = user?.emailAddresses[0]?.emailAddress;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable className="flex-1 bg-black/50" onPress={onClose}>
        <Pressable
          className="mt-auto rounded-t-3xl bg-background p-5"
          onPress={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <View className="mb-4 items-center">
            <View className="h-1 w-12 rounded-full bg-muted-foreground/30" />
          </View>

          {/* Header */}
          <Text className="mb-6 text-2xl font-sans-bold text-primary">
            User Settings
          </Text>

          {/* Profile Info */}
          <View className="mb-6 flex-row items-center gap-4">
            <Image
              source={user?.imageUrl ? { uri: user.imageUrl } : images.avatar}
              className="size-16 rounded-full"
            />
            <View className="flex-1">
              <Text className="text-lg font-sans-bold text-primary">
                {displayName}
              </Text>
              {email && (
                <Text className="text-sm font-sans-medium text-muted-foreground">
                  {email}
                </Text>
              )}
            </View>
          </View>

          {/* Preferences */}
          <Text className="mb-3 text-base font-sans-semibold text-primary">
            Notifications
          </Text>

          <View className="rounded-2xl border border-border bg-card p-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1">
                <Text className="text-sm font-sans-semibold text-primary">
                  Upcoming Renewal Reminders
                </Text>
                <Text className="text-xs font-sans-medium text-muted-foreground">
                  Daily notifications for subscriptions renewing within 7 days
                </Text>
              </View>
              <Switch
                value={notificationEnabled}
                onValueChange={setNotificationEnabled}
                trackColor={{ false: "#e5e5e5", true: "#ea7a53" }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Done button */}
          <Pressable
            className="mt-6 items-center rounded-2xl bg-accent py-4"
            onPress={onClose}
          >
            <Text className="text-base font-sans-bold text-primary">Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

export default UserSettingsModal;
