package app.picksandshovels.cadence.imap

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.widget.Toast
import java.util.concurrent.atomic.AtomicBoolean
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * R14 scan watchdog: a no-progress timer on a DEDICATED thread - not the
 * main looper, not RN's Timing module. Live evidence (three identical
 * thread dumps in the 2026-09-06 gate, plus the 2026-09-04 dump and the
 * 2026-09-05 run-2 wedge): when the network dies mid-leg, the MAIN thread
 * blocks inside NativeDisplayEventReceiver dispatchVsync's JNI transition
 * (zero CPU across 4+ minutes; RenderThread keeps animating the spinner,
 * so the UI looks alive). RN timer dispatch rides the Choreographer on
 * main, so every JS setTimeout - including every fetch wrapper AND the
 * pacing sleeps between Gmail calls - freezes with it, and the JS loop
 * parks between fetches where no socket exists for native callTimeouts to
 * bound. A main-looper watchdog froze the same way in that gate; this
 * 2026-09-04 thread dump and the 2026-09-05 run-2 wedge): mid-scan network
 * transients can leave the JS side parked forever — every RN fetch wrapper
 * and every pacing sleep depends on JS timer dispatch, which died silently
 * while the main thread kept rendering (spinner animated, pid alive, zero
 * sockets, no errors, no timeout lines). This module bounds that class
 * natively: JS arms a no-progress budget before each mailbox leg and feeds
 * countdown therefore runs on its own HandlerThread. On expiry it logs
 * natively and REJECTS the armed promise - promise delivery is the path
 * every Proton/Tuta/MSAL call already uses and does not require the
 * main looper, so a wakeable JS thread gets the failure and the leg
 * soft-fails into the per-mailbox error dialog instead of wedging.
 *
 * arm() re-arms (replaces any prior budget); feed() restarts the countdown
 * without changing it; cancel() disarms and silently resolves the pending
 * promise. All three run serialized on the native-modules thread; only the
 * expiry runnable runs on the watchdog thread, so @Volatile covers it.
 */
class WatchdogModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val watchdogThread = HandlerThread("MailWatchdog").apply { start() }
  private val handler = Handler(watchdogThread.looper)

  @Volatile private var budgetMs: Long = 0
  @Volatile private var pending: Promise? = null

  override fun getName(): String = "MailWatchdog"

  private val expire = Runnable {
    val p = pending ?: return@Runnable
    pending = null
    Log.w(TAG, "no scan progress for ${budgetMs}ms — failing the leg")
    p.reject(
      "SCAN_STALL",
      "Mail scan stalled: no network progress for ${budgetMs / 1000}s — the connection may have dropped mid-scan. Try scanning again.",
    )
  }

  /** Arms the no-progress budget; the returned promise rejects on stall. */
  @ReactMethod
  fun arm(budgetMs: Double, promise: Promise) {
    val timeout = budgetMs.toLong().coerceAtLeast(1_000L)
    handler.removeCallbacks(expire)
    this.budgetMs = timeout
    this.pending = promise
    handler.postDelayed(expire, timeout)
    Log.i(TAG, "armed ${timeout}ms no-progress budget")
  }

  /** Progress heartbeat — restarts the countdown, budget unchanged. */
  @ReactMethod
  fun feed() {
    if (pending == null) return
    handler.removeCallbacks(expire)
    handler.postDelayed(expire, budgetMs)
  }

  /** Disarms and silently resolves any pending wait. */
  @ReactMethod
  fun cancel() {
    handler.removeCallbacks(expire)
    val p = pending
    pending = null
    p?.resolve(null)
  }


  /**
   * R15 offline gate: is there a network with internet capability right now?
   * Cheap synchronous check used before every provider HTTP call.
   */
  @ReactMethod
  fun isOnline(promise: Promise) {
    val cm = reactApplicationContext.getSystemService(ConnectivityManager::class.java)
    val caps = cm?.activeNetwork?.let { cm.getNetworkCapabilities(it) }
    val online = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    promise.resolve(online)
  }

  /**
   * R15 offline gate: park on the NATIVE reconnect event. Resolves true when a
   * network with internet comes back, false after timeoutMs. Deliberately
   * event-driven (NetworkCallback) with zero JS timers, so the wait survives
   * the main-thread stall class that freezes RN timer dispatch (2026-09-06
   * gate evidence). While waiting: feeds the watchdog natively every 30s so a
   * legitimate offline pause can never be stall-killed, and shows a Toast so
   * the user knows the scan paused and will resume on its own.
   */
  @ReactMethod
  fun waitForOnline(timeoutMs: Double, promise: Promise) {
    val cm = reactApplicationContext.getSystemService(ConnectivityManager::class.java)
    if (cm == null) {
      promise.resolve(true)
      return
    }
    OnlineWait(cm, promise, timeoutMs.toLong().coerceAtLeast(1_000L)).start()
  }

  private inner class OnlineWait(
    private val cm: ConnectivityManager,
    private val promise: Promise,
    private val timeoutMs: Long,
  ) {
    private val done = AtomicBoolean(false)

    // Keep the no-progress watchdog fed while legitimately paused offline.
    private val feed = object : Runnable {
      override fun run() {
        if (done.get()) return
        if (pending != null) {
          handler.removeCallbacks(expire)
          handler.postDelayed(expire, budgetMs)
        }
        handler.postDelayed(this, 30_000L)
      }
    }

    private val timeout = Runnable { finish(false) }

    private val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        finish(true)
      }
    }

    fun finish(ok: Boolean) {
      if (!done.compareAndSet(false, true)) return
      handler.removeCallbacks(feed)
      handler.removeCallbacks(timeout)
      try {
        cm.unregisterNetworkCallback(callback)
      } catch (_: Exception) {
        // Already unregistered / never registered - nothing to do.
      }
      promise.resolve(ok)
    }

    fun start() {
      // Fast path: back online before the wait even starts.
      val caps = cm.activeNetwork?.let { cm.getNetworkCapabilities(it) }
      if (caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true) {
        promise.resolve(true)
        return
      }
      handler.post {
        Toast.makeText(
          reactApplicationContext,
          "Offline - scan paused; it will resume when the network is back",
          Toast.LENGTH_LONG,
        ).show()
      }
      try {
        cm.registerDefaultNetworkCallback(callback)
      } catch (e: Exception) {
        Log.w(TAG, "registerDefaultNetworkCallback failed; assuming online", e)
        promise.resolve(true)
        return
      }
      handler.postDelayed(feed, 30_000L)
      handler.postDelayed(timeout, timeoutMs)
    }
  }

  companion object {
    const val TAG = "MailWatchdog"
  }
}
