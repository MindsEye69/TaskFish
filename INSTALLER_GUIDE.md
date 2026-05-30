# Tasker: Windows Packaging & AI Bundling Guide

This guide outlines how to transform this Next.js project into a production-ready Windows Installer (`.exe`) that includes the AI engine.

## 1. Convert to a Desktop App
Next.js is a web framework, so you need a "wrapper" to make it a Windows app.
- **Recommended**: [Nextron](https://github.com/saltyshiomix/nextron) (Next.js + Electron)
- **Alternative**: [Tauri](https://tauri.app/) (Smaller bundle size, but uses Rust for the backend logic).

## 2. Bundling Ollama (The AI Engine)
Ollama doesn't currently provide a formal "library" for bundling, but you can include it as a **Sidecar Binary**.

### Steps:
1.  **Download Binaries**: Get the `ollama.exe` binary.
2.  **Extra Resources**: In your `electron-builder` configuration, add `ollama.exe` to the `extraResources` list.
3.  **Process Management**:
    - When your app launches, use Node's `child_process.exec` to check if `localhost:11434` is responding.
    - If not, spawn `ollama.exe serve` from the resources folder.
4.  **Model Loading**:
    - On first run, the app should execute `ollama pull gemma3:4b`.
    - To avoid a long first-run download, you can manually copy the `~/.ollama/models` folder into your installer's data path, but this will make the installer very large (~3GB+).

## 3. Creating the Installer
Use **Electron Builder** to generate a signed `.exe`.

### Package.json additions (Example):
```json
"build": {
  "appId": "com.tasker.app",
  "win": {
    "target": "nsis",
    "icon": "resources/icon.ico"
  },
  "extraResources": [
    {
      "from": "bin/ollama.exe",
      "to": "ollama.exe",
      "filter": ["**/*"]
    }
  ]
}
```

## 4. Hardware Acceleration
Since Gemma 3 runs locally, ensure the user has a modern GPU. Ollama will automatically detect NVIDIA (CUDA) or AMD (ROCm) GPUs. If no GPU is found, it will fall back to CPU, which might be slow for real-time analysis.

---

**Current Status**: Your PoC is now optimized with whitelists and autofills, ready for this final packaging stage.
