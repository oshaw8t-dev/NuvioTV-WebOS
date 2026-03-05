<div align="center">

  <img src="https://github.com/tapframe/NuvioTV/raw/dev/assets/brand/app_logo_wordmark.png" alt="NuvioTV webOS" width="300" />
  <br />
  <br />

  <p>
    A modern <b>LG webOS</b> media player powered by the Stremio addon ecosystem.
    <br />
    Stremio Addon ecosystem • webOS optimized • Playback-focused experience
  </p>

  <p>
    <b>Status: BETA</b> — experimental and may be unstable.
  </p>

</div>

## About

**NuvioTV webOS** is an experimental LG webOS TV client focused on playback and TV-first navigation.

It acts as a client-side interface that can integrate with the **Stremio addon ecosystem** for content discovery and source resolution through user-installed extensions.

> This repository is a **separate webOS-focused codebase** (HTML/CSS/JS) and is **not** the Android TV app.

## Upstream / Credits (Thank you tapframe)

This project is a webOS port / re-implementation inspired by the original Android TV project:

- **tapframe/NuvioTV** (Official Android TV Repository)  
  https://github.com/tapframe/NuvioTV

All credits for the original Android TV implementation go to **tapframe** and contributors.  
This webOS version is **not affiliated** with tapframe and is provided as an independent community effort.

## Installation (LG webOS)

**Status: Beta**  
This project is currently in early beta. Builds may be unstable or incomplete.

### Download

Precompiled `.ipk` packages will be available in the **Releases** section of this repository:

https://github.com/oshaw8t-dev/NuvioTV-WebOS/releases

Download the latest `.ipk` file compatible with your webOS TV.

---

### Installing on LG webOS TV (Developer Mode)

To install the application on your LG TV, you must enable **Developer Mode**.

#### 1️⃣ Install the Developer Mode App

On your LG TV:

1. Open the **LG Content Store**
2. Search for **"Developer Mode"**
3. Install the official *Developer Mode* app by LG
4. Launch it and log in with your LG developer account  
   (You can create one at https://webostv.developer.lge.com/)

#### 2️⃣ Enable Developer Mode

Inside the Developer Mode app:

- Enable **Developer Mode**
- Enable **Key Server**
- Note your TV's **IP Address**
- Restart the TV when prompted

---

#### 3️⃣ Install the IPK Package

Using your computer:

1. Install the **webOS TV CLI** from LG
2. Connect your TV:
   ```bash
   ares-setup-device
   ```
3. Install the app:
   ```bash
   ares-install com.nuvio.lg_1.0.1_all.ipk --device tv
   ```

## Development (LG webOS)

### Prerequisites
- webOS TV CLI / SDK
- A webOS TV device in Developer Mode (or emulator)

### Run locally
- Use `index.html` with a local web server and test in browser first
- Then package and install to webOS TV:
  ```bash
  ares-package . --no-minify
  ares-install --device tv com.nuvio.lg_1.0.1_all.ipk
  ```

## Legal & Disclaimer

This project functions solely as a client-side interface for browsing metadata and playing media provided by user-installed extensions and/or user-provided sources.  
It is intended for content the user owns or is otherwise authorized to access.

This project is not affiliated with third-party extensions or content providers and does not host, store, or distribute any media content.

(For the upstream Android TV project legal page, see tapframe/NuvioTV.)

## License

- Upstream Android TV project: see **tapframe/NuvioTV** repository license.
- This webOS repository: **GPL-3.0**

<!-- MARKDOWN LINKS & IMAGES -->
[contributors-shield]: https://img.shields.io/github/contributors/oshaw8t-dev/NuvioTV-WebOS.svg?style=for-the-badge
[contributors-url]: https://github.com/oshaw8t-dev/NuvioTV-WebOS/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/oshaw8t-dev/NuvioTV-WebOS.svg?style=for-the-badge
[forks-url]: https://github.com/oshaw8t-dev/NuvioTV-WebOS/network/members
[stars-shield]: https://img.shields.io/github/stars/oshaw8t-dev/NuvioTV-WebOS.svg?style=for-the-badge
[stars-url]: https://github.com/oshaw8t-dev/NuvioTV-WebOS/stargazers
[issues-shield]: https://img.shields.io/github/issues/oshaw8t-dev/NuvioTV-WebOS.svg?style=for-the-badge
[issues-url]: https://github.com/oshaw8t-dev/NuvioTV-WebOS/issues
[license-shield]: https://img.shields.io/github/license/oshaw8t-dev/NuvioTV-WebOS.svg?style=for-the-badge
[license-url]: ./LICENSE
