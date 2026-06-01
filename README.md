This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

## 🚀 Building for Windows (.exe)

1. **Pre-requisites**: Node.js 18+ and internet access (the build script auto-downloads the Ollama runtime).
2. **Build**:
   ```bash
   npm run electron-build
   ```
3. **Output**: Your installer will be generated in the `dist_electron/` folder.

> **Offline / CI builds**: set `TASKFISH_SKIP_OLLAMA_DOWNLOAD=1` together with `TASKFISH_ALLOW_MISSING_OLLAMA=1` to skip the Ollama download (AI features will be unavailable in that build).

## 🧠 AI Deep Scan
TaskFish uses an ephemeral AI architecture. It stores all analysis in a local cache to ensure zero RAM impact during normal operation. Click **Deep Scan** to analyze all unknown processes at once.

## Third-party AI Runtime

TaskFish bundles [Ollama](https://ollama.com) as a local AI runtime to power the **Analyze** and **Deep Scan** features. On first use, Ollama downloads a small open-weight model (e.g. `llama3.2:1b`, ~1 GB) to your machine.

**TaskFish does not own or license Ollama or any AI model.** Ollama is a separate open-source project distributed under its own terms. The models Ollama downloads are subject to their own upstream licenses (e.g. Meta's Llama community license for Llama-family models). By enabling AI features you agree to those upstream terms.

Core process management, enforcement rules, and the security center run fully without AI. Only the **Analyze** and **Deep Scan** actions require the local AI runtime.

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
