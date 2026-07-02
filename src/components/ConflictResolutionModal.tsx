import React, { useCallback, useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

interface ConflictRow {
  id: string;
  name: string;
  price: number;
  plan?: string;
  category?: string;
  billing?: string;
  status?: string;
}

interface ConflictResolutionModalProps {
  visible: boolean;
  conflicts: ConflictRow[];
  onResolve: (
    actions: {
      id: string;
      action: "merge_skip" | "merge_overwrite" | "duplicate";
      newId?: string;
    }[],
  ) => Promise<void>;
  onCancel: () => void;
}

const ConflictResolutionModal = ({
  visible,
  conflicts,
  onResolve,
  onCancel,
}: ConflictResolutionModalProps) => {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [applyToAll, setApplyToAll] = useState(false);
  const [mergeOverwrite, setMergeOverwrite] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [actions, setActions] = useState<
    {
      id: string;
      action: "merge_skip" | "merge_overwrite" | "duplicate";
      newId?: string;
    }[]
  >([]);

  // Reset state whenever modal opens with new conflicts
  useEffect(() => {
    if (visible) {
      setCurrentIdx(0);
      setApplyToAll(false);
      setMergeOverwrite(false);
      setResolving(false);
      setActions([]);
    }
  }, [visible, conflicts.length]);

  const current = conflicts[currentIdx];
  const isLast = currentIdx >= conflicts.length - 1;
  const totalConflicts = conflicts.length;
  const progressLabel = `Conflict ${currentIdx + 1} of ${totalConflicts}`;

  const handleMerge = useCallback(async () => {
    if (applyToAll) {
      // Apply "Merge" to all remaining conflicts
      const remaining = conflicts.slice(currentIdx).map((c) => ({
        id: c.id,
        action: (mergeOverwrite ? "merge_overwrite" : "merge_skip") as
          "merge_overwrite" | "merge_skip",
      }));
      const resolved = [...actions, ...remaining];
      setResolving(true);
      await onResolve(resolved);
    } else {
      // Record this single action
      const newAction = {
        id: current.id,
        action: (mergeOverwrite ? "merge_overwrite" : "merge_skip") as
          "merge_overwrite" | "merge_skip",
      };
      const updated = [...actions, newAction];
      setActions(updated);

      if (isLast) {
        setResolving(true);
        await onResolve(updated);
      } else {
        setCurrentIdx((i) => i + 1);
        setMergeOverwrite(false);
      }
    }
  }, [
    applyToAll,
    mergeOverwrite,
    conflicts,
    currentIdx,
    current,
    actions,
    isLast,
    onResolve,
  ]);

  const handleDuplicate = useCallback(async () => {
    if (applyToAll) {
      // Generate new IDs for all remaining conflicts
      const remaining = await Promise.all(
        conflicts.slice(currentIdx).map(async (c) => ({
          id: c.id,
          action: "duplicate" as const,
          newId: `${c.id}_imported_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        })),
      );
      const resolved = [...actions, ...remaining];
      setResolving(true);
      await onResolve(resolved);
    } else {
      // Duplicate this single item
      const newId = `${current.id}_imported_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const newAction = {
        id: current.id,
        action: "duplicate" as const,
        newId,
      };
      const updated = [...actions, newAction];
      setActions(updated);

      if (isLast) {
        setResolving(true);
        await onResolve(updated);
      } else {
        setCurrentIdx((i) => i + 1);
      }
    }
  }, [applyToAll, conflicts, currentIdx, current, actions, isLast, onResolve]);

  if (!current) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onCancel}
    >
      <View className="flex-1">
        <Pressable className="modal-overlay" onPress={onCancel}>
          <Pressable
            className="modal-container"
            onPress={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <View className="modal-header">
              <Text className="modal-title">Conflict Resolution</Text>
              <Text className="text-sm font-sans-medium text-muted-foreground">
                {progressLabel}
              </Text>
              <Pressable className="modal-close" onPress={onCancel}>
                <Text className="modal-close-text">✕</Text>
              </Pressable>
            </View>

            {/* Body */}
            <ScrollView
              className="modal-body"
              showsVerticalScrollIndicator={false}
            >
              {/* Conflict Details Card */}
              <View className="rounded-2xl border border-border bg-card p-4 mb-4">
                <View className="mb-3">
                  <Text className="text-lg font-sans-bold text-primary">
                    {current.name}
                  </Text>
                </View>

                <View className="gap-2">
                  <DetailRow label="ID" value={current.id} />
                  <DetailRow
                    label="Price"
                    value={`$${current.price.toFixed(2)}`}
                  />
                  {current.plan && (
                    <DetailRow label="Plan" value={current.plan} />
                  )}
                  {current.category && (
                    <DetailRow label="Category" value={current.category} />
                  )}
                  {current.billing && (
                    <DetailRow label="Billing" value={current.billing} />
                  )}
                  {current.status && (
                    <DetailRow label="Status" value={current.status} />
                  )}
                </View>
              </View>

              {/* Merge Mode Toggle */}
              {!applyToAll && (
                <View className="flex-row items-center gap-3 mb-4">
                  <Pressable
                    onPress={() => setMergeOverwrite(!mergeOverwrite)}
                    className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl border px-4 py-3 ${
                      mergeOverwrite
                        ? "border-accent bg-accent/10"
                        : "border-border bg-background"
                    }`}
                  >
                    <View
                      className={`size-5 items-center justify-center rounded-full border-2 ${
                        mergeOverwrite
                          ? "border-accent bg-accent"
                          : "border-muted-foreground"
                      }`}
                    >
                      {mergeOverwrite && (
                        <Text className="text-xs text-white">✓</Text>
                      )}
                    </View>
                    <Text
                      className={`text-sm font-sans-medium ${
                        mergeOverwrite ? "text-accent" : "text-muted-foreground"
                      }`}
                    >
                      Overwrite fields
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* Imported row info if overwrite mode */}
              {mergeOverwrite && !applyToAll && (
                <View className="mb-4 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
                  <Text className="text-xs font-sans-medium text-yellow-800">
                    Tap {'"'}Merge{'"'} to overwrite the local row with imported
                    data. Tap {'"'}Duplicate{'"'} to keep both.
                  </Text>
                </View>
              )}

              {/* Apply to All Toggle */}
              <View className="flex-row items-center gap-3 mb-4">
                <Pressable
                  onPress={() => setApplyToAll(!applyToAll)}
                  className={`flex-1 flex-row items-center justify-center gap-2 rounded-xl border px-4 py-3 ${
                    applyToAll
                      ? "border-accent bg-accent/10"
                      : "border-border bg-background"
                  }`}
                >
                  <View
                    className={`size-5 items-center justify-center rounded border-2 ${
                      applyToAll
                        ? "border-accent bg-accent"
                        : "border-muted-foreground"
                    }`}
                  >
                    {applyToAll && (
                      <Text className="text-xs text-white">✓</Text>
                    )}
                  </View>
                  <Text
                    className={`text-sm font-sans-medium ${
                      applyToAll ? "text-accent" : "text-muted-foreground"
                    }`}
                  >
                    Apply to all remaining conflicts
                  </Text>
                </Pressable>
              </View>

              {/* Summary text when Apply to All is checked */}
              {applyToAll && (
                <View className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
                  <Text className="text-xs font-sans-medium text-blue-800">
                    {mergeOverwrite
                      ? `"Merge" will overwrite all ${totalConflicts - currentIdx} remaining conflicts. "Duplicate" will import all as new entries.`
                      : `"Merge" will skip all ${totalConflicts - currentIdx} remaining conflicts (keep local). "Duplicate" will import all as new entries.`}
                  </Text>
                </View>
              )}

              {resolving && (
                <View className="mb-4">
                  <Text className="text-center text-sm font-sans-medium text-muted-foreground">
                    Processing...
                  </Text>
                </View>
              )}

              {/* Action Buttons */}
              <View className="flex-row gap-3">
                <Pressable
                  className="flex-1 rounded-2xl bg-accent px-4 py-4"
                  onPress={handleMerge}
                  disabled={resolving}
                >
                  <Text className="text-center font-sans-bold text-white">
                    {applyToAll ? "Merge All" : "Merge"}
                  </Text>
                </Pressable>
                <Pressable
                  className="flex-1 rounded-2xl bg-primary px-4 py-4"
                  onPress={handleDuplicate}
                  disabled={resolving}
                >
                  <Text className="text-center font-sans-bold text-white">
                    {applyToAll ? "Duplicate All" : "Duplicate"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
};

// Small helper component for detail rows
const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <View className="flex-row justify-between items-center py-1">
    <Text className="text-sm font-sans-medium text-muted-foreground">
      {label}
    </Text>
    <Text className="text-sm font-sans-medium text-primary" numberOfLines={1}>
      {value}
    </Text>
  </View>
);

export default ConflictResolutionModal;
