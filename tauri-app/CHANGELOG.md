# Changelog

## [0.4.0](https://github.com/remi-deher/maps-main/compare/gpsmock-v0.3.14...gpsmock-v0.4.0) (2026-06-23)


### Features

* admin privileges, process tree cleanup, and sudo hint ([10ab754](https://github.com/remi-deher/maps-main/commit/10ab754c7468b1a942c975bba995317b21736a09))
* bundle both iOS drivers in the Tauri desktop app + default to go-ios ([94b92a5](https://github.com/remi-deher/maps-main/commit/94b92a5f2e289708a8492f3ac467019a85cac99b))
* network interface selection for mDNS, QR-code pairing, and fix the broken iOS settings button ([dba2898](https://github.com/remi-deher/maps-main/commit/dba2898fdb53ac6d47a57e167fe1b41c222efdff))
* settings persistence (SQLite), web-managed OSRM/cluster tuning, iOS background keep-alive and search-bar redesign ([aa1e97b](https://github.com/remi-deher/maps-main/commit/aa1e97b7a2118a38f38d1f1ca559107c715cb431))
* v3 engine rewrite, Tauri/iOS clients, CI/CD and security hardening (squashed history from 9dd28a8) ([e395eca](https://github.com/remi-deher/maps-main/commit/e395eca0cf6d5f0aa6d805cec24691179ef601f9))
* **web:** surface engine LOG/LOGS events as banners (C2) ([c470099](https://github.com/remi-deher/maps-main/commit/c470099b12ad69a011450d82bc77a7d14e6e7066))


### Bug Fixes

* patch container vulnerability scan ([d64febd](https://github.com/remi-deher/maps-main/commit/d64febd6ea71298a203315ad53bbbc324eb432b1))
* **web:** keyboard/SR-accessible search results and map controls (3.2, 3.8) ([4cad58a](https://github.com/remi-deher/maps-main/commit/4cad58a49c95bddde1a505eda66c098d0d171ec9))
* **web:** lang=fr, visible keyboard focus, prefers-reduced-motion ([64508cb](https://github.com/remi-deher/maps-main/commit/64508cb9bcbdad77176d74edc76d6e237ca6766d))
* **web:** make Sidebar list items and GPX dropzone keyboard-accessible (B5) ([d3038b6](https://github.com/remi-deher/maps-main/commit/d3038b67920d6bb3e1a1f940ed9d6e17eb12d716))
* **web:** robust geocoding fetch (AbortController, error state, drop dead UA) ([ee04659](https://github.com/remi-deher/maps-main/commit/ee04659de1e12ec526b5be8582add8ea717c1d02))
* **web:** tighten mobile layout + 44px touch targets (B2) ([eb3ed87](https://github.com/remi-deher/maps-main/commit/eb3ed87b0a34059f089bb2ab9de7860626067abe))
