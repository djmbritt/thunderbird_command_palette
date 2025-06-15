# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Thunderbird extension that provides a command palette (like VS Code's Ctrl+Shift+P) for quick access to Thunderbird functions. The extension uses TypeScript, Webpack, and the WebExtension API.

## Development Commands

- `npm run build` - Build the extension for production
- `npm run dev` - Build in development mode with file watching
- `npm run clean` - Remove the dist directory
- `npm run package` - Build and create a web-ext package in artifacts/
- `npm run zip` - Create a simple zip file

## Architecture

### Core Components

- **Background Script** (`src/background.ts`): Main extension logic that runs persistently. Manages the CommandRegistry and handles browser events.
- **Command Registry** (`src/commands/registry.ts`): Central registry for all commands with search functionality using fuzzy search.
- **Popup UI** (`src/popup.ts`): The command palette interface that appears when triggered.
- **Fuzzy Search** (`src/utils/fuzzySearch.ts`): Custom fuzzy search implementation with scoring and highlighting.

### Extension Architecture

The extension follows a message-passing architecture:
1. Background script registers commands and handles execution
2. Popup UI sends messages to background script for command search/execution
3. Commands are dynamically registered for unified folders and account-specific folders

### Key Features

- **Dynamic Command Registration**: Commands are registered for each mail account and folder type
- **Fuzzy Search**: Custom implementation with scoring based on character matches, word boundaries, and camelCase
- **Unified and Account-Specific Folders**: Supports both unified folders (across all accounts) and account-specific folder navigation
- **Keyboard Navigation**: Full keyboard support (arrow keys, enter, escape)

### WebExtension Manifest

Uses manifest v2 with Thunderbird-specific APIs:
- `accounts` API for mail account access
- `folders` API for folder navigation
- `mailTabs` API for tab management
- `compose` API for message composition

### Build Process

Webpack bundles TypeScript sources into `dist/` directory and copies static files (manifest.json, popup.html, popup.css). The extension can be loaded as a temporary extension or packaged for distribution.