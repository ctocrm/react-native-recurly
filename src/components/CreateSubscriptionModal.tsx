import { icons } from "@/constants/icons";
import { searchLogos } from "@/lib/resolveLogo";
import clsx from "clsx";
import dayjs from "dayjs";
import { usePostHog } from "posthog-react-native";
import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

const CATEGORIES = [
  "Entertainment",
  "AI Tools",
  "Developer Tools",
  "Productivity",
  "Cloud",
  "Music",
  "Design",
  "Other",
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  Entertainment: "#f5c542",
  "AI Tools": "#b8d4e3",
  "Developer Tools": "#e8def8",
  Productivity: "#8fd1bd",
  Cloud: "#b8e8d0",
  Music: "#d4a8e8",
  Design: "#f5c542",
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
  const posthog = usePostHog();
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [frequency, setFrequency] = useState<"Monthly" | "Yearly">("Monthly");
  const [category, setCategory] = useState<string>("Other");
  const [selectedIcon, setSelectedIcon] = useState(icons.plus);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState<
    { name: string; icon: any; category?: string }[]
  >([]);

  const isNameValid = name.trim().length > 0;
  const parsedPrice = parseFloat(price);
  const isPriceValid = !isNaN(parsedPrice) && parsedPrice > 0;
  const formValid = isNameValid && isPriceValid;

  const resetForm = useCallback(() => {
    setName("");
    setPrice("");
    setFrequency("Monthly");
    setCategory("Other");
    setSelectedIcon(icons.plus);
    setShowAutocomplete(false);
    setAutocompleteResults([]);
  }, []);

  // Track modal open and reset form whenever the modal visibility changes
  useEffect(() => {
    if (visible) {
      posthog.capture("create_subscription_modal_opened");
    }
    resetForm();
  }, [visible, resetForm, posthog]);

  const handleNameChange = (text: string) => {
    setName(text);
    if (text.trim().length > 0) {
      const results = searchLogos(text);
      setAutocompleteResults(results);
      setShowAutocomplete(results.length > 0);
    } else {
      setShowAutocomplete(false);
      setAutocompleteResults([]);
      setSelectedIcon(icons.plus);
    }
  };

  const handleSelectBrand = (brand: {
    name: string;
    icon: any;
    category?: string;
  }) => {
    setName(brand.name);
    setSelectedIcon(brand.icon);
    if (brand.category) {
      setCategory(brand.category);
    }
    setShowAutocomplete(false);
    setAutocompleteResults([]);
  };

  const handleDismiss = useCallback(() => {
    const hasInput = name.trim().length > 0 || price.length > 0;
    posthog.capture("create_subscription_modal_dismissed", {
      has_input: hasInput,
    });
    onClose();
  }, [name, price, onClose, posthog]);

  const handleSubmit = () => {
    if (!formValid) return;

    const now = dayjs();
    const renewalDate =
      frequency === "Yearly" ? now.add(1, "year") : now.add(1, "month");

    // Resolve the icon key from the selected icon
    const iconEntry = Object.entries(icons).find(
      ([, val]) => val === selectedIcon,
    );
    const iconKey = iconEntry ? iconEntry[0] : "plus";

    const subscription: Subscription = {
      id: Date.now().toString(),
      icon: selectedIcon,
      icon_key: iconKey,
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

    posthog.capture("subscription_created", {
      subscription_name: name.trim(),
      subscription_price: parsedPrice,
      subscription_category: category,
      subscription_frequency: frequency,
    });

    onCreate(subscription);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleDismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <Pressable className="modal-overlay" onPress={handleDismiss}>
          <Pressable
            className="modal-container"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View className="modal-header">
              <Text className="modal-title">New Subscription</Text>
              <Pressable className="modal-close" onPress={handleDismiss}>
                <Text className="modal-close-text">✕</Text>
              </Pressable>
            </View>

            {/* Body */}
            <ScrollView
              className="modal-body"
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Logo preview */}
              <View className="mb-2 items-center">
                <Image source={selectedIcon} className="size-16 rounded-lg" />
              </View>

              {/* Name */}
              <View className="auth-field">
                <Text className="auth-label">Name</Text>
                <View className="relative z-20">
                  <TextInput
                    className="auth-input"
                    value={name}
                    placeholder="e.g. Netflix"
                    placeholderTextColor="rgba(0, 0, 0, 0.4)"
                    onChangeText={handleNameChange}
                    onFocus={() => {
                      if (autocompleteResults.length > 0)
                        setShowAutocomplete(true);
                    }}
                    autoCapitalize="words"
                  />
                  {showAutocomplete && autocompleteResults.length > 0 && (
                    <View className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
                      <FlatList
                        data={autocompleteResults}
                        keyExtractor={(item, index) => `${item.name}-${index}`}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item }) => (
                          <Pressable
                            className="flex-row items-center gap-3 px-4 py-3"
                            onPress={() => handleSelectBrand(item)}
                          >
                            <Image
                              source={item.icon}
                              className="size-8 rounded-md"
                            />
                            <Text className="font-sans-medium text-primary">
                              {item.name}
                            </Text>
                          </Pressable>
                        )}
                      />
                    </View>
                  )}
                </View>
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
