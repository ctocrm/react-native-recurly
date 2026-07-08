import React, { forwardRef, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

export type ProcessOp = "removeWhiteBg" | "detectWhiteBg";

export interface ImageProcessHandle {
  process: (dataUri: string, op: ProcessOp, tolerance?: number) => Promise<any>;
}

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body><script>
window.onmessage = function (e) {
  var msg = JSON.parse(e.data);
  if (msg.type !== 'process') return;
  var img = new Image();
  img.onload = function () {
    var w = img.width, h = img.height;
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    try {
      if (msg.op === 'detectWhiteBg') {
        var tol = msg.tolerance || 30;
        var pts = [[0,0],[w-1,0],[0,h-1],[w-1,h-1],
                   [Math.floor(w/2),0],[0,Math.floor(h/2)],
                   [w-1,Math.floor(h/2)],[Math.floor(w/2),h-1]];
        var white = 0;
        for (var i = 0; i < pts.length; i++) {
          var d = ctx.getImageData(pts[i][0], pts[i][1], 1, 1).data;
          if (d[0] > 255 - tol && d[1] > 255 - tol && d[2] > 255 - tol) white++;
        }
        var ratio = white / pts.length;
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'result', id: msg.id, payload: ratio >= 0.6
        }));
      } else if (msg.op === 'removeWhiteBg') {
        var tol2 = msg.tolerance || 30;
        var imgd = ctx.getImageData(0, 0, w, h);
        var px = imgd.data;
        for (var j = 0; j < px.length; j += 4) {
          if (px[j] > 255 - tol2 && px[j+1] > 255 - tol2 && px[j+2] > 255 - tol2) {
            px[j+3] = 0;
          }
        }
        ctx.putImageData(imgd, 0, 0);
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'result', id: msg.id, payload: canvas.toDataURL('image/png')
        }));
      }
    } catch (err) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'result', id: msg.id, payload: msg.op === 'detectWhiteBg' ? false : null
      }));
    }
  };
  img.onerror = function () {
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type: 'result', id: msg.id, payload: msg.op === 'detectWhiteBg' ? false : null
    }));
  };
  img.src = msg.dataUri;
};
</script></body></html>`;

const ImageProcessWebView = forwardRef<ImageProcessHandle>((_, ref) => {
  const webviewRef = useRef<WebView>(null);
  const pending = useRef<
    Record<
      number,
      {
        resolve: (v: any) => void;
        reject: (e: any) => void;
      }
    >
  >({});
  const reqId = useRef(0);

  useImperativeHandle(ref, () => ({
    process(dataUri: string, op: ProcessOp, tolerance = 30) {
      return new Promise((resolve, reject) => {
        const id = ++reqId.current;
        pending.current[id] = { resolve, reject };
        const msg = JSON.stringify({
          type: "process",
          id,
          dataUri,
          op,
          tolerance,
        });
        // WebView must be mounted; postMessage triggers the injected handler.
        webviewRef.current?.postMessage(msg);
      });
    },
  }));

  const onMessage = (e: any) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === "result" && pending.current[data.id]) {
        pending.current[data.id].resolve(data.payload);
        delete pending.current[data.id];
      }
    } catch {
      // ignore malformed messages
    }
  };

  return (
    <View style={{ height: 0, width: 0, opacity: 0 }} pointerEvents="none">
      <WebView
        ref={webviewRef}
        source={{ html: HTML }}
        onMessage={onMessage}
        javaScriptEnabled
        originWhitelist={["*"]}
      />
    </View>
  );
});

ImageProcessWebView.displayName = "ImageProcessWebView";

export default ImageProcessWebView;
