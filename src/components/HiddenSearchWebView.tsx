/**
 * Hidden WebView component for background web scraping.
 * This component is invisible but active - it loads search pages in the background
 * and extracts links using injected JavaScript, bypassing anti-bot detection.
 * Only rendered on native platforms (iOS/Android) - WebView doesn't work on web.
 */

import React, { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";

import {
  getInjectionScript,
  getSearchUrl,
  handleWebViewMessage,
  setSearchTriggerCallback,
} from "@/src/services/webViewSearchEngine";

interface HiddenSearchWebViewProps {
  onSearchComplete?: (urls: string[]) => void;
}

const HiddenSearchWebView: React.FC<HiddenSearchWebViewProps> = () => {
  // Only load WebView on native platforms
  const [WebView, setWebView] = useState<any>(null);

  useEffect(() => {
    if (Platform.OS !== "web") {
       
      const WebViewComponent = require("react-native-webview").WebView;
      setWebView(() => WebViewComponent);
    }
  }, []);

  const [searchUrl, setSearchUrl] = useState<string>("");
  const [injectionScript, setInjectionScript] = useState<string>("");
  const webViewRef = useRef<any>(null);

  // Register the search trigger callback on mount - always mounted
  useEffect(() => {
    setSearchTriggerCallback((brand: string, requestId: string) => {
      console.log(
        `[WEBVIEW_COMPONENT] Triggering search for "${brand}" (requestId: ${requestId})`,
      );
      setSearchUrl(getSearchUrl(brand));
      setInjectionScript(getInjectionScript(requestId));
    });

    return () => {
      setSearchTriggerCallback(null);
    };
  }, []);

  const handleMessage = (event: any) => {
    handleWebViewMessage(event);
  };

  const handleLoadComplete = () => {
    if (injectionScript && webViewRef.current) {
      console.log("[WEBVIEW_COMPONENT] Page loaded, injecting script");
      webViewRef.current.injectJavaScript(injectionScript);
    }
  };

  // Reset state after search completes (allow next search)
  useEffect(() => {
    if (!searchUrl) return;

    const timer = setTimeout(() => {
      // Reset the WebView state to allow next search
      setSearchUrl("");
      setInjectionScript("");
    }, 20000); // Give plenty of time for results

    return () => clearTimeout(timer);
  }, [searchUrl]);

  // Don't render on web platform
  if (Platform.OS === "web" || !WebView) {
    return null;
  }

  // Always render the WebView so the callback is registered
  // It's invisible but can be triggered via the callback
  return (
    <View
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        opacity: 0,
        zIndex: -1,
      }}
      pointerEvents="none"
    >
      <WebView
        ref={webViewRef}
        source={{ uri: searchUrl || "about:blank" }}
        onMessage={handleMessage}
        onLoad={handleLoadComplete}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={["https://*", "http://*"]}
        mixedContentMode="compatibility"
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      />
    </View>
  );
};

export default HiddenSearchWebView;
