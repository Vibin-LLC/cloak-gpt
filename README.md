# Cloak GPT <img src="https://github.com/Vibin-LLC/cloak-gpt/blob/main/media/og-icon.png?raw=true" alt="Cloak GPT Logo" width="50">


A translucent ChatGPT overlay desktop application that allows you to use ChatGPT.com undetectably (invisible to screen share, hidden keystrokes) without switching between windows.

## Features

- Transparent overlay that stays on top of other applications
- Global keyboard shortcuts for quick access
- Stealth cursor mode for discreet usage
- Multiple layout options
- Automatic updates via GitHub Releases
- Undetectable by other applications: invisible during screen sharing and hides keystrokes from other apps

## Keyboard Shortcuts

- Show/hide overlay: ⌘ + B
- Open/close settings: ⌘ + ,
- Submit message: ⌘ + ↩
- Clear input: ⌘ + ⌫
- Take screenshot: ⌘ + S
- Toggle layout: ⌘ + V
- Switch models: ⌘ + M
- New chat: ⌘ + N
- Increase transparency: ⌘ + +
- Decrease transparency: ⌘ + -
- Move cursor: ↑ ↓ ← →
- Click at cursor: ↩
- Scroll chat up: ⌘ + ↑
- Scroll chat down: ⌘ + ↓

## Auto-Update Setup

This application uses Electron Forge with automatic updates via GitHub Releases. The setup includes:

### Configuration

1. **Forge Configuration** (`forge.config.js`):
   - GitHub publisher configured for `Vibin-LLC/cloak-gpt`
   - Publishes to GitHub Releases for automatic updates

2. **Auto-Update Code** (`src/main.ts`):
   - Uses `update-electron-app` for seamless updates
   - Automatically checks for updates on app startup
   - Downloads and installs updates in the background

### Publishing Process

1. **Version Management**:
   - Use the release script: `./scripts/release.sh 1.0.1`
   - Or manually update version in `package.json` and create a git tag: `git tag v1.0.1 && git push origin v1.0.1`

2. **Automated Publishing**:
   - GitHub Actions workflow (`.github/workflows/publish.yml`) automatically builds and publishes when a tag is pushed
   - Creates a GitHub Release with the built application
   - Users automatically receive update notifications

3. **Manual Publishing** (if needed):
   ```bash
   npm run make
   npx electron-forge publish
   ```

## Development

```bash
# Install dependencies
npm install

# Build the application
npm run build

# Start in development mode
npm start

# Package for distribution
npm run make
```

## Building for Production

```bash
# Build and packages for production
npm run make

# The built application will be in the `out/` directory
```

## Auto-Update for Users

Users will automatically receive updates when:
1. A new version is published to GitHub Releases
2. The app checks for updates on startup
3. Updates are downloaded and installed automatically

The update process is seamless and requires no user intervention.

## Troubleshooting

- If auto-updates aren't working, check that the GitHub repository is public
- Ensure the GitHub token has the necessary permissions
- Verify that releases are being created with the correct assets


# Upcoming Features
- Release & Optimize Windows build
- Support [Google Gemani](https://gemini.google.com/) , [Claude](https://claude.ai/)