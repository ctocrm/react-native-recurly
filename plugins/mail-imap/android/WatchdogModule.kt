package app.picksandshovels.cadence.imap

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * R14 scan watchdog: a no-progress timer that lives on the Android main
 * looper, deliberately OUTSIDE RN's Timing module. Live evidence (the
 * 2026-09-04 thread dump and the 2026-09-05 run-2 wedge): mid-scan network
 * transients can leave the JS side parked forever — every RN fetch wrapper
 * and every pacing sleep depends on JS timer dispatch, which died silently
 * while the main thread kept rendering (spinner animated, pid alive, zero
 * sockets, no errors, no timeout lines). This module bounds that class
 * natively: JS arms a no-progress budget before each mailbox leg and feeds
 * it as pages/chunks land. If the budget expires, the handler fires on the
 * main looper and REJECTS the armed promise — native promise resolution is
 * the same delivery path every Proton/Tuta/MSAL call already uses, so an
 * idle-but-wakeable JS thread gets the failure and the leg soft-fails into
 * the per-mailbox error dialog instead of wedging the whole scan.
 *
 * arm() re-arms (replaces any prior budget); feed() restarts the countdown
 * without changing it; cancel() disarms and silently resolves the pending
 * promise. All three run serialized on the native-modules thread; only the
 * expiry runnable runs on main, so @Volatile covers the cross-thread read.
 */
class WatchdogModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val main = Handler(Looper.getMainLooper())

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
    main.removeCallbacks(expire)
    this.budgetMs = timeout
    this.pending = promise
    main.postDelayed(expire, timeout)
    Log.i(TAG, "armed ${timeout}ms no-progress budget")
  }

  /** Progress heartbeat — restarts the countdown, budget unchanged. */
  @ReactMethod
  fun feed() {
    if (pending == null) return
    main.removeCallbacks(expire)
    main.postDelayed(expire, budgetMs)
  }

  /** Disarms and silently resolves any pending wait. */
  @ReactMethod
  fun cancel() {
    main.removeCallbacks(expire)
    val p = pending
    pending = null
    p?.resolve(null)
  }

  companion object {
    const val TAG = "MailWatchdog"
  }
}
