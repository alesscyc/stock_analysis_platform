# AI chat connection settings

## Problem Statement

Browser users cannot configure the AI chat connection in Settings. Desktop users can save it, but must restart before chat uses the new URL or API key.

## Solution

Make the AI chat service URL and API key available in the existing Settings sidebar in browser and desktop clients connected to a backend. Save them on that backend and apply them to subsequent requests immediately. Keep the model picker in chat.

## User Stories

1. As a browser user, I want the AI connection fields in Settings so that I can configure chat without editing an environment file.
2. As a desktop user, I want the same fields in Settings so that configuration stays in its existing location.
3. As a user, I want to save the service URL so that chat reaches my chosen provider.
4. As a user, I want to replace the API key so that chat uses my chosen credentials.
5. As a user, I want an empty key input to preserve the saved key so that changing the URL does not erase credentials.
6. As a user, I want to see whether a key is configured without receiving its saved value so that I can confirm setup without exposing the key.
7. As a user, I want saved changes to apply to the next request so that I do not need to restart.
8. As a user, I want requests already running to finish using their original connection so that saving does not interrupt them.
9. As a user, I want clients connected to the same backend to share saved connection settings so that configuration is consistent.
10. As a user, I want available models to refresh after the connection changes so that chat reflects the selected provider.
11. As a user, I want invalid settings and failed saves to report errors so that I know whether changes took effect.
12. As a user, I want the model picker to stay in chat so that I can continue choosing models there.
13. As a user, I want Settings labels in English and Traditional Chinese so that connection setup follows my language preference.
14. As a user, I want untrusted websites and remote clients prevented from changing this local connection so that they cannot redirect my saved API key.

## Implementation Decisions

- Reuse the existing Settings sidebar, validation, environment persistence, masked-secret convention, and blank-key preservation.
- Separate browser-accessible AI connection updates from desktop IB and other connection settings. Do not make the general desktop settings API available to browser clients.
- Keep saved API keys on the backend. Do not return them in settings responses or persist them in browser storage.
- Protect AI connection reads and writes against untrusted origins and non-local requests. Account for the local Vite development proxy and the desktop same-origin app.
- Persist changes before applying them. A failed save must not silently replace the running connection.
- Snapshot the connection for each outgoing chat or model-list request. A save must not mix an old URL with a new key inside an in-flight request.
- Refresh model discovery after a successful connection change. Preserve request cancellation and prevent stale model responses from replacing newer results.
- Retain the existing configured-default-model requirement and existing desktop default-model control. Do not add a new model-setup flow.
- Preserve unrelated desktop save/restart behavior, chat safety checks, and order validation.

## Testing Decisions

- Exercise user-visible behavior through the existing Settings sidebar component tests and backend HTTP tests; use existing environment persistence tests where appropriate.
- Assert browser visibility, save payloads, configured-key status, blank-key preservation, validation failures, and useful error feedback.
- Verify persistence and immediate effect using a fake AI provider, including an in-flight request crossing a configuration save.
- Verify that malicious origins, non-local requests, and attempts to update unrelated settings are rejected.
- Verify model refresh and existing chat/model-picker behavior without real credentials or paid provider calls.
- Run browser E2E against the local app with a fake provider, plus the frontend test, lint, build, and backend test commands.

## Out of Scope

- Moving the model picker out of chat.
- Exposing IB or other desktop-only connection settings in the browser.
- Configuring AI chat on static GitHub Pages without a backend.
- Adding a new model-setup flow, key-deletion control, provider framework, authentication system, or third-party dependency.
- Changing trading, chat safety, or order execution behavior.

## Further Notes

Changing the URL changes where the saved API key is sent. This is a local backend configuration feature, not a remote administration API. The glossary term for the URL/key pair is “AI chat connection.”
