# MOYSTER · Compose Multiplatform PWA

This feature branch replaces the plain JavaScript interface with **Kotlin Compose Multiplatform / WebAssembly**. It retains the New Orleans oyster restaurant directory and happy-hour filters.

## Run
With JDK 21 and Gradle 8.14.3:

```bash
gradle :composeApp:wasmJsBrowserDevelopmentRun
gradle :composeApp:wasmJsBrowserDistribution
```

Web production output: `composeApp/build/dist/wasmJs/productionExecutable/`.

## Organization
- `composeApp/src/commonMain/kotlin`: Compose UI, search, filtering, deal times and restaurant cards
- `composeApp/src/commonMain/composeResources/files/deals.json`: bundled directory (offline)
- `composeApp/src/wasmJsMain/kotlin`: WebAssembly entry point
- `composeApp/src/wasmJsMain/resources`: HTML shell, PWA manifest, icon, service worker
- `.github/workflows/deploy-pages.yml`: builds Wasm artifact and deploys that directory on merge to main
- `.github/workflows/compose-check.yml`: verifies builds before merge

## Important
The bundled directory is a dated snapshot. Updating root `data/deals.json` alone does not update the Compose app. Update the bundled resource as well, or later introduce a network-first data sync with local fallback. PWA offline behavior is best-effort: the service worker must cache generated Wasm assets during a successful online visit. Modern WasmGC-compatible browsers are required for this build. Do not merge until CI passes.

Existing static HTML remains on the default branch while this change is reviewed.
