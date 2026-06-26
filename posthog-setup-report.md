<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog into the Recurrly subscription management app (Expo / React Native). The integration covers user identification via Clerk authentication, event capture across all key user actions, autocapture for touch events, manual screen tracking for Expo Router, and a PostHog dashboard with 5 insights.

**Files created:**
- `app.config.js` — reads `app.json` and injects `posthogProjectToken` and `posthogHost` into Expo's `extra` config, making them available at runtime via `expo-constants`
- `src/config/posthog.ts` — PostHog singleton configured from `Constants.expoConfig.extra`, with batching, retry, and feature-flag settings

**Files modified:**
- `app/_layout.tsx` — added `PostHogProvider` (wrapping `ClerkProvider`), manual screen tracking via `usePathname` + `useEffect`, and autocapture config
- `app/(auth)/signIn.tsx` — `posthog.identify()` + `user_signed_in` on success, `user_sign_in_failed` on error, `sign_in_mfa_code_sent` on MFA flow
- `app/(auth)/signUp.tsx` — `posthog.identify()` + `user_signed_up` on completion, `user_sign_up_failed` on error, `sign_up_email_verification_sent` on verification send
- `app/(tabs)/settings.tsx` — `user_signed_out` + `posthog.reset()` on sign-out
- `app/(tabs)/index.tsx` — `subscription_card_expanded` / `subscription_card_collapsed` with subscription metadata
- `app/onboarding.tsx` — `onboarding_viewed` on mount (top of acquisition funnel)
- `app/subscriptions/[id].tsx` — `subscription_detail_viewed` with subscription ID

**Packages installed:** `posthog-react-native@^4.52.0`, `react-native-svg@15.12.1`

| Event name | Description | File |
|---|---|---|
| `user_signed_in` | User successfully completes sign-in | `app/(auth)/signIn.tsx` |
| `user_sign_in_failed` | Sign-in attempt fails with a Clerk error | `app/(auth)/signIn.tsx` |
| `sign_in_mfa_code_sent` | MFA email code is sent during client trust verification | `app/(auth)/signIn.tsx` |
| `user_signed_up` | User completes email verification and creates account | `app/(auth)/signUp.tsx` |
| `user_sign_up_failed` | Sign-up attempt fails with a Clerk error | `app/(auth)/signUp.tsx` |
| `sign_up_email_verification_sent` | Verification email is sent during sign-up | `app/(auth)/signUp.tsx` |
| `user_signed_out` | User signs out from settings | `app/(tabs)/settings.tsx` |
| `subscription_card_expanded` | User expands a subscription card to see details | `app/(tabs)/index.tsx` |
| `subscription_card_collapsed` | User collapses an expanded subscription card | `app/(tabs)/index.tsx` |
| `onboarding_viewed` | User views the onboarding screen (top of funnel) | `app/onboarding.tsx` |
| `subscription_detail_viewed` | User navigates to a subscription detail page | `app/subscriptions/[id].tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/473831/dashboard/1763188)
- [New Sign-ups Over Time](https://us.posthog.com/project/473831/insights/fQH47VKF)
- [Sign-in Failures](https://us.posthog.com/project/473831/insights/6wfqSoeI)
- [Sign-up Completion Funnel](https://us.posthog.com/project/473831/insights/7mUuEtjV)
- [Authentication Events Overview](https://us.posthog.com/project/473831/insights/osUnb6mi)
- [Subscription Card Engagement](https://us.posthog.com/project/473831/insights/u4SXOlAY)

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` to `.env.example` (and any bootstrap scripts) so collaborators know what to set.
- [ ] Confirm the returning-visitor path also calls `identify` — the current implementation identifies on sign-in and sign-up, but a session restored from `expo-secure-store` (Clerk's token cache) skips both flows and may leave returning sessions on anonymous distinct IDs. Add an `identify` call in the Clerk session restore / `useAuth` initialization if needed.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
