# AI chat connection settings

Status: Scope agreed; awaiting final shared-understanding confirmation before implementation.

## Agreed behavior

- Show the AI chat service URL and API key in the existing Settings sidebar in both the browser app connected to a backend and the desktop app.
- Keep the model picker in chat. Preserve the existing default-model controls.
- Persist the URL and key on the connected backend. Clients using that backend share its AI chat connection.
- Never return the saved API key to the browser. Show whether a key is configured; an empty key input preserves the saved key.
- Apply a successful save to subsequent chat requests without restarting. Allow requests already running to finish with their original connection.

## Implementation boundaries

Reuse the existing Settings sidebar, field validation, and secret-preservation behavior. Expose only the AI connection settings needed by browser clients; do not expose desktop IB or other connection settings through this change. Preserve the existing desktop settings save behavior for unrelated fields.

Keep connection updates restricted to trusted local app requests. The current web backend permits CORS, so simply removing the desktop gate from the general settings endpoint is insufficient. Changing the service URL changes where the configured API key is sent.

Refresh the available model list after a connection change. Preserve existing chat safety checks, order validation, error handling, and request cancellation. Keep the existing requirement for a configured default model; this change does not add a new model-setup flow.

Static GitHub Pages has no backend and therefore cannot save or use an AI chat connection through this feature.

## Verification

Add focused frontend and backend tests covering browser visibility, masked keys, blank-key preservation, persisted settings, immediate application, rejected invalid or untrusted updates, and refreshed model discovery. Verify both English and Traditional Chinese labels. Run frontend tests, lint, build, and backend tests.

## Documentation

The root glossary defines “AI chat connection” as the service URL and API key. This reversible settings change does not require an ADR.
