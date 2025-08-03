const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const os = require('os');
const dotenv = require('dotenv');
dotenv.config();

function getIcon() {
  const platformArg = process.argv.find(arg => arg.startsWith('--platform='));
  const platform = platformArg ? platformArg.split('=')[1] : os.platform();
  switch (platform) {
    case 'darwin':
      return 'media/icons/icons/mac/icon';
    case 'win32':
      return 'media/icons/icons/win/icon';
    default:
      throw new Error('Unsupported platform for icon selection');
  }
}

module.exports = {
  packagerConfig: {
    asar: true,
    icon: getIcon(),
    arch: ['x64', 'arm64'],

    // Signing configuration
    osxSign: {
      'hardened-runtime': true,
      entitlements: 'entitlements.plist',
      'entitlements-inherit': 'entitlements.plist',
      identity: 'Developer ID Application: Vibin LLC (U99WN9B24L)',
      keychainProfile: 'cloak-gpt'
    },

    // Notarization configuration (must also be in packagerConfig)
    osxNotarize: {
      keychainProfile: 'cloak-gpt'
    },
  },

  rebuildConfig: {},

  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        arch: ['x64', 'arm64'],
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
      config: {
        arch: ['x64', 'arm64'],
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],

  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'Vibin-LLC',
          name: 'cloak-gpt'
        },
        prerelease: false,
        token: process.env.GITHUB_TOKEN
      }
    }
  ],

  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
}