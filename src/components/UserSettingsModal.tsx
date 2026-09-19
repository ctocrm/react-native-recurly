import images from "@/constants/images";
import { useSubscriptions } from "@/context/SubscriptionContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { setPreference } from "@/services/database";
import { useUser } from "@/context/AuthContext";
import * as DocumentPicker from "expo-document-picker";
import { readAsStringAsync } from "expo-file-system/legacy";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

interface UserSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const UserSettingsModal = ({ visible, onClose }: UserSettingsModalProps) => {
  const { sheetPadding } = useBottomClearance();
  const { user } = useUser();
  const { notificationEnabled, setNotificationEnabled } = useSubscriptions();

  // Profile editing state
  const [editMode, setEditMode] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [importingAvatar, setImportingAvatar] = useState(false);

  // Sync form state when user changes
  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setAvatarUrl(user.imageUrl || "");
    }
  }, [user?.id]);

  const displayName =
    user?.firstName ||
    user?.fullName ||
    user?.emailAddresses[0]?.emailAddress ||
    "User";
  const email = user?.emailAddresses[0]?.emailAddress;

  const handleSaveProfile = async () => {
    if (saving) return;

    // Validate required fields
    if (!firstName.trim() && !lastName.trim() && !avatarUrl) {
      Alert.alert(
        "Error",
        "Please enter at least a first name, last name, or select an avatar.",
      );
      return;
    }

    setSaving(true);
    try {
      if (firstName.trim()) {
        await setPreference("user_first_name", firstName.trim());
      }
      if (lastName.trim()) {
        await setPreference("user_last_name", lastName.trim());
      }
      if (avatarUrl) {
        await setPreference("user_avatar_url", avatarUrl);
      }

      setEditMode(false);
      Alert.alert("Success", "Profile updated on this device.");
    } catch (error) {
      console.error("Failed to update profile:", error);
      Alert.alert("Error", "Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleImportAvatar = async () => {
    setImportingAvatar(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "image/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return;
      }

      const file = result.assets?.[0];
      if (!file) {
        return;
      }

      const fileUri = file.uri;

      // Convert file to base64
      const base64 = await readAsStringAsync(fileUri, {
        encoding: "base64",
      });

      // Convert to data URI format
      const mimeType = file.mimeType || "image/jpeg";
      const dataUri = `data:${mimeType};base64,${base64}`;

      setAvatarUrl(dataUri);
    } catch (error) {
      console.error("Failed to import avatar:", error);
      Alert.alert("Error", "Failed to import image. Please try again.");
    } finally {
      setImportingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      setAvatarUrl("");
      await setPreference("user_avatar_url", "");
      Alert.alert("Success", "Avatar removed successfully!");
    } catch (error) {
      console.error("Failed to remove avatar:", error);
      Alert.alert("Error", "Failed to remove avatar. Please try again.");
    }
  };

  const handleChangePassword = () => {
    Alert.alert(
      "Change Password",
      "Local login has no password. A product account service will replace this later.",
      [{ text: "OK" }],
    );
  };

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
          style={{ paddingBottom: sheetPadding }}
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
          <View className="mb-6 flex-row items-start gap-4">
            <Image
              source={
                avatarUrl
                  ? { uri: avatarUrl }
                  : user?.imageUrl
                    ? { uri: user.imageUrl }
                    : images.avatar
              }
              className="size-16 rounded-full"
            />
            <View className="flex-1">
              {editMode ? (
                <>
                  <TextInput
                    className="auth-input mb-2"
                    value={firstName}
                    placeholder="First Name"
                    onChangeText={setFirstName}
                    autoCapitalize="words"
                  />
                  <TextInput
                    className="auth-input mb-2"
                    value={lastName}
                    placeholder="Last Name"
                    onChangeText={setLastName}
                    autoCapitalize="words"
                  />
                  <View className="flex-row gap-2 mb-2">
                    <Pressable
                      className="auth-button bg-primary flex-1"
                      onPress={handleImportAvatar}
                      disabled={importingAvatar}
                    >
                      <Text className="auth-button-text text-white">
                        {importingAvatar ? "Importing..." : "Import Avatar"}
                      </Text>
                    </Pressable>
                    {avatarUrl && (
                      <Pressable
                        className="auth-button bg-destructive flex-1"
                        onPress={handleRemoveAvatar}
                      >
                        <Text className="auth-button-text text-white">
                          Remove
                        </Text>
                      </Pressable>
                    )}
                  </View>
                </>
              ) : (
                <>
                  <Text className="text-lg font-sans-bold text-primary">
                    {displayName}
                  </Text>
                  {email && (
                    <Text className="text-sm font-sans-medium text-muted-foreground">
                      {email}
                    </Text>
                  )}
                </>
              )}
            </View>
            <Pressable
              className="ml-2 rounded-xl bg-accent/10 px-3 py-1"
              onPress={() => setEditMode(!editMode)}
            >
              <Text className="text-sm font-sans-semibold text-accent">
                {editMode ? "Cancel" : "Edit"}
              </Text>
            </Pressable>
          </View>

          {editMode && (
            <Pressable
              className={`auth-button bg-accent mb-4 ${saving ? "opacity-50" : ""}`}
              onPress={handleSaveProfile}
              disabled={saving}
            >
              <Text className="auth-button-text text-primary">
                {saving ? (
                  <>
                    <ActivityIndicator
                      size="small"
                      color="#fff"
                      style={{ marginRight: 8 }}
                    />
                    Saving...
                  </>
                ) : (
                  "Save Profile"
                )}
              </Text>
            </Pressable>
          )}

          {/* Change Password */}
          <View className="rounded-2xl border border-border bg-card p-4 mb-4">
            <Pressable
              className="flex-row items-center justify-between"
              onPress={handleChangePassword}
            >
              <View className="flex-1">
                <Text className="text-sm font-sans-semibold text-primary">
                  Change Password
                </Text>
                <Text className="text-xs font-sans-medium text-muted-foreground">
                  Update your account password
                </Text>
              </View>
            </Pressable>
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
