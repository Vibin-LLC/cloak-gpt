#!/bin/bash

# Release script for Cloak GPT
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 1.0.1

if [ $# -eq 0 ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 1.0.1"
    exit 1
fi

VERSION=$1

echo "🚀 Preparing release for version $VERSION"

# Update package.json version
npm version $VERSION --no-git-tag-version

# Build the application
echo "📦 Building application..."
npm run build

# Package for distribution
echo "📦 Packaging application..."
npm run make

# Create git tag
echo "🏷️  Creating git tag v$VERSION..."
git add .
git commit -m "Release version $VERSION"
git tag v$VERSION

# Push tag to remote and publish release locally
echo "📤 Pushing tag v$VERSION to remote..."
git push origin v$VERSION

echo "🚀 Publishing release v$VERSION to GitHub Releases..."
npx electron-forge publish

echo "🎉 Release v$VERSION published!"