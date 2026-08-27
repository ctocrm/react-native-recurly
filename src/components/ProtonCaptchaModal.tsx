import { useBottomClearance } from "@/hooks/useBottomClearance";
import {
  isProtonVerifyUrl,
  setProtonCaptchaHandler,
  type ProtonCaptchaResult,
  type ProtonHvChallenge,
} from "@/services/emailscan/protonCaptcha";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

const ANDROID_INTERFACE_JS = `
(function () {
  if (window.AndroidInterface && window.AndroidInterface.dispatch) {
    return true;
  }
  window.AndroidInterface = {
    dispatch: function (msg) {
      try {
        var payload = typeof msg === "string" ? msg : JSON.stringify(msg);
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(payload);
        }
      } catch (e) {}
    },
  };
  window.addEventListener("message", function (event) {
    try {
      var data = event && event.data;
      if (!data) return;
      var parsed = typeof data === "string" ? JSON.parse(data) : data;
      if (parsed && parsed.type === "HUMAN_VERIFICATION_SUCCESS") {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(parsed));
        }
      }
    } catch (e) {}
  });
  true;
})();
`;

type Pending = {
  challenge: ProtonHvChallenge;
  resolve: (value: ProtonCaptchaResult) => void;
  reject: (error: Error) => void;
};

const ProtonCaptchaModal = () => {
  const { sheetPadding } = useBottomClearance();
  const [pending, setPending] = useState<Pending | null>(null);
  const settled = useRef(false);

  useEffect(() => {
    setProtonCaptchaHandler(
      (challenge) =>
        new Promise<ProtonCaptchaResult>((resolve, reject) => {
          settled.current = false;
          setPending({ challenge, resolve, reject });
        }),
    );
    return () => {
      setProtonCaptchaHandler(null);
    };
  }, []);

  const finish = (result: ProtonCaptchaResult | Error) => {
    if (!pending || settled.current) return;
    settled.current = true;
    if (result instanceof Error) {
      pending.reject(result);
    } else {
      pending.resolve(result);
    }
    setPending(null);
  };

  const onMessage = (event: WebViewMessageEvent) => {
    const raw = event.nativeEvent.data;
    if (!raw) return;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (
        parsed?.type === "HUMAN_VERIFICATION_SUCCESS" &&
        parsed.payload?.token
      ) {
        finish({
          token: String(parsed.payload.token),
          type: String(parsed.payload.type || "captcha"),
        });
        return;
      }
      if (parsed?.type === "CLOSE") {
        finish(new Error("Proton CAPTCHA cancelled"));
      }
    } catch {
      // ignore non-JSON frames from the captcha iframe
    }
  };

  const uri = useMemo(() => {
    const raw = pending?.challenge.webUrl ?? "";
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      if (!parsed.searchParams.has("embed")) {
        parsed.searchParams.set("embed", "1");
      }
      return parsed.toString();
    } catch {
      return raw;
    }
  }, [pending?.challenge.webUrl]);
  const source = useMemo(() => (uri ? { uri } : undefined), [uri]);

  return (
    <Modal
      visible={pending !== null}
      animationType="slide"
      transparent
      onRequestClose={() => finish(new Error("Proton CAPTCHA cancelled"))}
    >
      <View className="flex-1 bg-black/50">
        <View
          className="mt-12 flex-1 rounded-t-3xl bg-background"
          style={{ paddingBottom: sheetPadding }}
        >
          <View className="flex-row items-center justify-between px-5 pb-3 pt-4">
            <Text className="text-lg font-sans-bold text-primary">
              Proton verification
            </Text>
            <Pressable
              className="rounded-xl bg-muted px-3 py-2"
              onPress={() => finish(new Error("Proton CAPTCHA cancelled"))}
            >
              <Text className="text-sm font-sans-bold text-primary">
                Cancel
              </Text>
            </Pressable>
          </View>
          {source ? (
            <WebView
              source={source}
              style={{ flex: 1 }}
              originWhitelist={["https://*"]}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              injectedJavaScriptBeforeContentLoaded={ANDROID_INTERFACE_JS}
              injectedJavaScript={ANDROID_INTERFACE_JS}
              onMessage={onMessage}
              onShouldStartLoadWithRequest={(request) => {
                if (!request.url) return true;
                try {
                  const host = new URL(request.url).hostname;
                  return (
                    host === "verify.proton.me" ||
                    host.endsWith(".proton.me") ||
                    isProtonVerifyUrl(request.url)
                  );
                } catch {
                  return false;
                }
              }}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

export default ProtonCaptchaModal;
