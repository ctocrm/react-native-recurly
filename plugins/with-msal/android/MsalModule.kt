package app.picksandshovels.cadence.msal

import android.app.Activity
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.microsoft.identity.client.AcquireTokenParameters
import com.microsoft.identity.client.AcquireTokenSilentParameters
import com.microsoft.identity.client.AuthenticationCallback
import com.microsoft.identity.client.IAccount
import com.microsoft.identity.client.IAuthenticationResult
import com.microsoft.identity.client.IMultipleAccountPublicClientApplication
import com.microsoft.identity.client.IPublicClientApplication
import com.microsoft.identity.client.PublicClientApplication
import com.microsoft.identity.client.exception.MsalClientException
import com.microsoft.identity.client.exception.MsalException
import com.microsoft.identity.client.exception.MsalServiceException
import com.microsoft.identity.client.exception.MsalUiRequiredException

/**
 * Thin bridge onto the official Microsoft MSAL Android SDK (R6 hardening).
 *
 * acquireTokenInteractive runs Microsoft's complete auth journey — sign-in,
 * consent, and any challenge Microsoft decides to issue (e.g. the "Verify
 * your email" code it mails to the account's recovery address) — inside
 * MSAL's managed auth surface, then hands the result back to JS.
 *
 * acquireTokenSilent is token reuse when valid: MSAL serves its encrypted
 * cache and refreshes internally, never launching UI.
 *
 * Retry policy lives in JS (msalAuth.classifyMsalError): a failed or
 * cancelled attempt is never retried automatically — repeated incomplete
 * MSA attempts make Microsoft challenge harder (2026-09-04 bombardment).
 */
class MsalModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private var pca: IMultipleAccountPublicClientApplication? = null

  override fun getName(): String = "Msal"

  @ReactMethod
  fun initialize(configResource: String, promise: Promise) {
    try {
      val context = reactContext.applicationContext
      val resId =
        context.resources.getIdentifier(configResource, "raw", context.packageName)
      if (resId == 0) {
        promise.reject(
          "MSAL_CONFIG_MISSING",
          "res/raw/$configResource.json is missing from the build",
          null,
        )
        return
      }
      PublicClientApplication.createMultipleAccountPublicClientApplication(
        context,
        resId,
        object : IPublicClientApplication.IMultipleAccountApplicationCreatedListener {
          override fun onCreated(application: IMultipleAccountPublicClientApplication) {
            pca = application
            promise.resolve(true)
          }

          override fun onError(exception: MsalException) {
            promise.reject("MSAL_INIT_FAILED", exception.message, exception)
          }
        },
      )
    } catch (e: Exception) {
      promise.reject("MSAL_INIT_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun acquireTokenInteractive(scopes: ReadableArray, promise: Promise) {
    val app = pca ?: return rejectNotInitialized(promise)
    val activity: Activity = reactContext.currentActivity ?: run {
      promise.reject("MSAL_NO_ACTIVITY", "No foreground activity for interactive sign-in", null)
      return
    }
    val params = AcquireTokenParameters.Builder()
      .startAuthorizationFromActivity(activity)
      .withScopes(scopes.toArrayList().map { it.toString() })
      .withCallback(authCallback(promise))
      .build()
    app.acquireToken(params)
  }

  @ReactMethod
  fun acquireTokenSilent(
    accountId: String,
    scopes: ReadableArray,
    forceRefresh: Boolean,
    promise: Promise,
  ) {
    val app = pca ?: return rejectNotInitialized(promise)
    val account = app.getAccount(accountId) ?: run {
      promise.reject(
        "MSAL_NO_ACCOUNT",
        "No cached MSAL account $accountId — interactive sign-in required",
        null,
      )
      return
    }
    val params = AcquireTokenSilentParameters.Builder()
      .forAccount(account)
      .fromAuthority("https://login.microsoftonline.com/common")
      .withScopes(scopes.toArrayList().map { it.toString() })
      .forceRefresh(forceRefresh)
      .withCallback(authCallback(promise))
      .build()
    app.acquireTokenSilentAsync(params)
  }

  @ReactMethod
  fun getAccounts(promise: Promise) {
    val app = pca ?: return rejectNotInitialized(promise)
    try {
      val arr: WritableArray = Arguments.createArray()
      for (account in app.accounts) arr.pushMap(accountToMap(account))
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("MSAL_CLIENT", e.message, e)
    }
  }

  @ReactMethod
  fun signOut(accountId: String, promise: Promise) {
    val app = pca ?: return rejectNotInitialized(promise)
    val account = app.getAccount(accountId) ?: run {
      promise.resolve(false)
      return
    }
    app.removeAccount(
      account,
      object : IMultipleAccountPublicClientApplication.RemoveAccountCallback {
        override fun onRemoved() {
          promise.resolve(true)
        }

        override fun onError(exception: MsalException) {
          promise.reject("MSAL_SERVICE", exception.message, exception)
        }
      },
    )
  }

  private fun authCallback(promise: Promise): AuthenticationCallback {
    return object : AuthenticationCallback {
      override fun onSuccess(result: IAuthenticationResult) {
        val map: WritableMap = Arguments.createMap()
        map.putString("accessToken", result.accessToken)
        result.expiresOn?.let { map.putDouble("expiresAt", it.time.toDouble()) }
        map.putString("accountId", result.account.id)
        map.putString("username", result.account.username)
        promise.resolve(map)
      }

      override fun onError(exception: MsalException) {
        promise.reject(errorCode(exception), detail(exception), exception)
      }

      override fun onCancel() {
        promise.reject("MSAL_USER_CANCELLED", "Sign-in cancelled", null)
      }
    }
  }

  private fun errorCode(exception: MsalException): String = when (exception) {
    is MsalUiRequiredException -> "MSAL_INTERACTION_REQUIRED"
    is MsalServiceException -> "MSAL_SERVICE"
    is MsalClientException ->
      // MsalClientException has no USER_CANCELLED constant in msal 4.9.x;
      // cancellation surfaces either via onCancel() or this string code.
      if (exception.errorCode == "user_cancelled") "MSAL_USER_CANCELLED"
      else "MSAL_CLIENT"
    else -> "MSAL_CLIENT"
  }

  private fun detail(exception: MsalException): String {
    val serviceCode = (exception as? MsalServiceException)?.errorCode
    return if (serviceCode.isNullOrEmpty()) exception.message ?: exception.javaClass.simpleName
    else "$serviceCode: ${exception.message}"
  }

  private fun accountToMap(account: IAccount): WritableMap {
    val map = Arguments.createMap()
    map.putString("accountId", account.id)
    map.putString("username", account.username)
    return map
  }

  private fun rejectNotInitialized(promise: Promise) {
    promise.reject("MSAL_NOT_INITIALIZED", "Msal.initialize has not completed", null)
  }
}