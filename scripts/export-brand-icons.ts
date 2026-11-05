#!/usr/bin/env node
// Renders every brand icon from assets/<variant>/icon.svg. Needs `rsvg-convert` (librsvg) on PATH.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

class IconRenderError extends Data.TaggedError("IconRenderError")<{
  readonly message: string;
}> {}

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

const exportBrandIcons = Effect.fn("exportBrandIcons")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* path.fromFileUrl(new URL("..", import.meta.url));
  const scratch = yield* fs.makeTempDirectoryScoped({ prefix: "aprende-icons-" });
  let renders = 0;

  const render = Effect.fn("exportBrandIcons.render")(function* (svg: string, size: number) {
    const input = path.join(scratch, `${renders}.svg`);
    const output = path.join(scratch, `${renders++}.png`);
    yield* fs.writeFileString(input, svg);
    const child = yield* spawner.spawn(
      ChildProcess.make("rsvg-convert", ["-w", `${size}`, "-h", `${size}`, input, "-o", output]),
    );
    const exitCode = Number(yield* child.exitCode);
    if (exitCode !== 0) {
      return yield* new IconRenderError({ message: `rsvg-convert exited with ${exitCode}.` });
    }
    return Buffer.from(yield* fs.readFile(output));
  });
  const write = (relativePath: string, contents: Uint8Array) =>
    fs.writeFile(path.join(root, relativePath), contents);

  for (const variant of VARIANTS) {
    const tile = yield* fs.readFileString(path.join(root, variant.source));
    if (!tile.includes(TILE_VIEW_BOX)) {
      return yield* new IconRenderError({
        message: `${variant.source} must use ${TILE_VIEW_BOX}.`,
      });
    }
    yield* write(variant.ios, yield* render(fullBleed(tile), 1024));
    yield* write(variant.macos, yield* render(tile, 1024));
    yield* write(variant.universal, yield* render(tile, 1024));
    yield* write(variant.appleTouch, yield* render(fullBleed(tile), 180));
    const favicons = [];
    for (const size of [16, 32, 48]) {
      favicons.push({ size, contents: yield* render(cropped(tile), size) });
    }
    yield* write(variant.favicon16, favicons[0]!.contents);
    yield* write(variant.favicon32, favicons[1]!.contents);
    yield* write(variant.faviconIco, encodePngIco(favicons));
    const windows = [];
    for (const size of WINDOWS_ICON_SIZES) {
      windows.push({ size, contents: yield* render(size <= 48 ? cropped(tile) : tile, size) });
    }
    yield* write(variant.windowsIco, encodePngIco(windows));
  }

  for (const override of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
    yield* fs.copyFile(
      path.join(root, override.sourceRelativePath),
      path.join(root, override.targetRelativePath),
    );
  }
  yield* Console.log("Exported brand icons.");
});

if (import.meta.main) {
  exportBrandIcons().pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
