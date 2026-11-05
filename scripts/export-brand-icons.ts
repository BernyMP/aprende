#!/usr/bin/env node
// Renders every brand icon from assets/<variant>/icon.svg. Needs `rsvg-convert` (librsvg) on PATH.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const repositoryRoot = NodePath.join(import.meta.dirname, "..");

const VARIANTS = [
  {
    source: BRAND_ASSET_PATHS.developmentIconSvg,
    ios: BRAND_ASSET_PATHS.developmentIosIconPng,
    macos: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
    appleTouch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    windowsIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
  },
  {
    source: BRAND_ASSET_PATHS.nightlyIconSvg,
    ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
    macos: BRAND_ASSET_PATHS.nightlyMacIconPng,
    universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
    appleTouch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    windowsIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
  },
  {
    source: BRAND_ASSET_PATHS.productionIconSvg,
    ios: BRAND_ASSET_PATHS.productionIosIconPng,
    macos: BRAND_ASSET_PATHS.productionMacIconPng,
    universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
    appleTouch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    windowsIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
  },
] as const;

// icon.svg is the macOS tile: an 824px rounded body inset 100px. These views reuse it.
const TILE_VIEW_BOX = 'viewBox="0 0 1024 1024"';
const fullBleed = (svg: string) =>
  svg.replace(
    /<rect x="100" y="100" width="824" height="824" rx="\d+"/,
    '<rect width="1024" height="1024"',
  );
const cropped = (svg: string) => svg.replace(TILE_VIEW_BOX, 'viewBox="100 100 824 824"');

const render = (svg: string, size: number): Buffer =>
  NodeChildProcess.execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size)], {
    input: svg,
  });

const write = (relativePath: string, contents: Buffer) =>
  NodeFS.writeFileSync(NodePath.join(repositoryRoot, relativePath), contents);

for (const variant of VARIANTS) {
  const tile = NodeFS.readFileSync(NodePath.join(repositoryRoot, variant.source), "utf8");
  if (!tile.includes(TILE_VIEW_BOX))
    throw new Error(`${variant.source} must use ${TILE_VIEW_BOX}.`);
  write(variant.ios, render(fullBleed(tile), 1024));
  write(variant.macos, render(tile, 1024));
  write(variant.universal, render(tile, 1024));
  write(variant.appleTouch, render(fullBleed(tile), 180));
  const favicons = [16, 32, 48].map((size) => ({ size, contents: render(cropped(tile), size) }));
  write(variant.favicon16, favicons[0]!.contents);
  write(variant.favicon32, favicons[1]!.contents);
  write(variant.faviconIco, encodePngIco(favicons));
  write(
    variant.windowsIco,
    encodePngIco(
      WINDOWS_ICON_SIZES.map((size) => ({
        size,
        contents: render(size <= 48 ? cropped(tile) : tile, size),
      })),
    ),
  );
}

for (const override of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
  NodeFS.copyFileSync(
    NodePath.join(repositoryRoot, override.sourceRelativePath),
    NodePath.join(repositoryRoot, override.targetRelativePath),
  );
}

console.log("Exported brand icons.");
