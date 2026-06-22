// Manual mock for react-native to avoid version incompatibility issues
// between react@19.1.0 and @react-native/jest-preset

const React = require("react");

const View = ({ children, testID, style, ...props }) =>
  React.createElement("View", { testID, style, ...props }, children);
View.displayName = "View";

const Text = ({ children, testID, style, className, ...props }) =>
  React.createElement("Text", { testID, style, className, ...props }, children);
Text.displayName = "Text";

const Image = ({ testID, style, source, resizeMode, className, ...props }) =>
  React.createElement("Image", { testID, style, source, resizeMode, className, ...props });
Image.displayName = "Image";

const TouchableOpacity = ({ children, testID, style, onPress, ...props }) =>
  React.createElement("TouchableOpacity", { testID, style, onPress, ...props }, children);
TouchableOpacity.displayName = "TouchableOpacity";

const ScrollView = ({ children, testID, style, ...props }) =>
  React.createElement("ScrollView", { testID, style, ...props }, children);
ScrollView.displayName = "ScrollView";

const SafeAreaView = ({ children, testID, style, className, ...props }) =>
  React.createElement("SafeAreaView", { testID, style, className, ...props }, children);
SafeAreaView.displayName = "SafeAreaView";

module.exports = {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StyleSheet: {
    create: (styles) => styles,
    flatten: (style) => style,
  },
  Platform: {
    OS: "ios",
    select: (obj) => obj.ios ?? obj.default,
  },
  Dimensions: {
    get: () => ({ width: 375, height: 812 }),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  Animated: {
    View: View,
    Text: Text,
    Value: jest.fn(() => ({
      interpolate: jest.fn(),
      setValue: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    })),
    timing: jest.fn(() => ({ start: jest.fn() })),
    spring: jest.fn(() => ({ start: jest.fn() })),
    sequence: jest.fn(() => ({ start: jest.fn() })),
    parallel: jest.fn(() => ({ start: jest.fn() })),
  },
};