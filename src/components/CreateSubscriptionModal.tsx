import { icons } from "@/constants/icons";
import clsx from "clsx";
import dayjs from "dayjs";
import React, { useState } from "react";
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View
} from "react-native";

const CATEGORIES = [
  "Entertainment",
  "AI Tools",
  "Developer Tools",
  "Productivity",
  "Cloud",
  "Music",
  "Other",
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  Entertainment: "#f5c542",
  "AI Tools": "#b8d4e3",
  "Developer Tools": "#e8def8",
  Productivity: "#8fd1bd",
  Cloud: "#b8e8d0",
  Music: "#d4a8e8",
  Other: "#c4c4c4",
};

interface CreateSubscriptionModalProps {
  visible: boolean;
  onClose: () => void;
  onCreate: (subscription: Subscription) => void;
}

const CreateSubscriptionModal = ({
  visible,
  onClose,
  onCreate,
}: CreateSubscriptionModalProps) => {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [frequency, setFrequency] = useState<"Monthly" | "Yearly">("Monthly");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);

  const isNameValid = name.trim().length > 0;
  const parsedPrice = parseFloat(price);
  const isPriceValid = !isNaN(parsedPrice) && parsedPrice > 0;
  const formValid = isNameValid && isPriceValid;

  const handleSubmit = () => {
    if (!formValid) return;

    const now = dayjs();
    const renewalDate =
      frequency === "Yearly" ? now.add(1, "year") : now.add(1, "month");

    const subscription: Subscription = {
      id: Date.now().toString(),
      icon: icons.wallet,
      name: name.trim(),
      price: parsedPrice,
      currency: "USD",
      category,
      frequency,
      billing: frequency,
      status: "active",
      startDate: now.toISOString(),
      renewalDate: renewalDate.toISOString(),
      color: CATEGORY_COLORS[category] || CATEGORY_COLORS.Other,
    };

    onCreate(subscription);

    // Reset form
    setName("");
    setPrice("");
    setFrequency("Monthly");
    setCategory(CATEGORIES[0]);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable className="modal-overlay" onPress={onClose}>
          <Pressable
            className="modal-container"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View className="modal-header">
              <Text className="modal-title">New Subscription</Text>
              <Pressable className="modal-close" onPress={onClose}>
                <Text className="modal-close-text">✕</Text>
              </Pressable>
            </View>

            {/* Body */}
            <ScrollView
              className="modal-body"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Name */}
              <View className="auth-field">
                <Text className="auth-label">Name</Text>
                <TextInput
                  className="auth-input"
                  value={name}
                  placeholder="e.g. Netflix"
                  placeholderTextColor="rgba(0, 0, 0, 0.4)"
                  onChangeText={setName}
                  autoCapitalize="words"
                />
              </View>

              {/* Price */}
              <View className="auth-field">
                <Text className="auth-label">Price</Text>
                <TextInput
                  className="auth-input"
                  value={price}
                  placeholder="0.00"
                  placeholderTextColor="rgba(0, 0, 0, 0.4)"
                  onChangeText={setPrice}
                  keyboardType="decimal-pad"
                />
              </View>

              {/* Frequency */}
              <View className="auth-field">
                <Text className="auth-label">Frequency</Text>
                <View className="picker-row">
                  <Pressable
                    className={clsx(
                      "picker-option",
                      frequency === "Monthly" && "picker-option-active",
                    )}
                    onPress={() => setFrequency("Monthly")}
                  >
                    <Text
                      className={clsx(
                        "picker-option-text",
                        frequency === "Monthly" && "picker-option-text-active",
                      )}
                    >
                      Monthly
                    </Text>
                  </Pressable>
                  <Pressable
                    className={clsx(
                      "picker-option",
                      frequency === "Yearly" && "picker-option-active",
                    )}
                    onPress={() => setFrequency("Yearly")}
                  >
                    <Text
                      className={clsx(
                        "picker-option-text",
                        frequency === "Yearly" && "picker-option-text-active",
                      )}
                    >
                      Yearly
                    </Text>
                  </Pressable>
                </View>
              </View>

              {/* Category */}
              <View className="auth-field">
                <Text className="auth-label">Category</Text>
                <View className="category-scroll">
                  {CATEGORIES.map((cat) => (
                    <Pressable
                      key={cat}
                      className={clsx(
                        "category-chip",
                        category === cat && "category-chip-active",
                      )}
                      onPress={() => setCategory(cat)}
                    >
                      <Text
                        className={clsx(
                          "category-chip-text",
                          category === cat && "category-chip-text-active",
                        )}
                      >
                        {cat}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {/* Submit */}
              <Pressable
                className={clsx(
                  "auth-button",
                  !formValid && "auth-button-disabled",
                )}
                onPress={handleSubmit}
                disabled={!formValid}
              >
                <Text className="auth-button-text">Create Subscription</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
};

export default CreateSubscriptionModal;
