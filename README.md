# Kino — Desktop Media Center

Kino is a desktop media center app built with Electron, React, TypeScript, and Vite. It is designed around a cinematic browsing experience for movies, shows, anime, and personal watch activity using Stremio-compatible addons.

The goal of Kino is to feel closer to a native streaming app than a basic web catalog: profiles, addon-powered discovery, source selection, progress tracking, episode browsing, and a desktop-first player workflow.

> Kino is a personal solo project and experimental media interface. It does not ship with hardcoded media sources or debrid integrations.

## What Kino does

Kino lets users install Stremio-compatible addons, browse catalog content, search across media, open movie/show detail pages, select streams, and track what they have watched.

The app focuses on:

- A polished desktop media-center interface
- Stremio-compatible addon support
- Profile-based local data
- Movie and series browsing
- Search and metadata pages
- Episode selection for shows
- Source selection and playback workflow
- Continue-watching progress
- Watched badges and watch-state tracking
- Local persistence through SQLite
- A desktop app architecture using Electron

## Why I built it

I built Kino to explore what a modern desktop media center could feel like if it combined the flexibility of Stremio-style addons with a more cinematic, focused user experience.

A lot of media apps either feel too technical, too web-like, or too cluttered. Kino is my attempt to design something that feels more intentional: poster-first, fast to browse, and structured around how people actually decide what to watch.

This project also helped me practice product design, frontend architecture, Electron app development, local data storage, and AI-assisted development workflows.

## Current status

Kino is still in active development. The repo started as an MVP for installing Stremio-compatible addons, but has since grown into a fuller desktop media-center prototype.

Some areas may still be experimental, incomplete, or changing as the app evolves.

## Tech stack

- **Electron** — desktop shell and native app runtime
- **React** — renderer UI
- **TypeScript** — type-safe app code
- **Vite** — fast frontend build tooling
- **SQLite / better-sqlite3** — local persistence
- **Rust / native modules** — experimental embedded player work
- **Stremio-compatible addons** — addon manifests, catalogs, metadata, and streams

## Core features

### Addon installation

Users can install Stremio-compatible addons by pasting a base URL or direct `manifest.json` URL. Kino normalizes the URL, fetches the manifest, validates it, and stores the addon locally.

Supported input examples:

```txt
https://example.com/
https://example.com/path
https://example.com/path/manifest.json
stremio://example.com/manifest.json
