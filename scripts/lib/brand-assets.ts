export const BRAND_ASSET_PATHS = {
  developmentIconSvg: "assets/dev/icon.svg",
  developmentIosIconPng: "assets/dev/aprende-dev-ios-1024.png",
  developmentUniversalIconPng: "assets/dev/aprende-dev-universal-1024.png",

  productionIconSvg: "assets/prod/icon.svg",
  productionIosIconPng: "assets/prod/aprende-ios-1024.png",
  productionMacIconPng: "assets/prod/aprende-macos-1024.png",
  productionLinuxIconPng: "assets/prod/aprende-universal-1024.png",
  productionWindowsIconIco: "assets/prod/aprende-windows.ico",
  productionWebFaviconIco: "assets/prod/aprende-web-favicon.ico",
  productionWebFavicon16Png: "assets/prod/aprende-web-favicon-16x16.png",
  productionWebFavicon32Png: "assets/prod/aprende-web-favicon-32x32.png",
  productionWebAppleTouchIconPng: "assets/prod/aprende-web-apple-touch-180.png",

  nightlyIconSvg: "assets/nightly/icon.svg",
  nightlyIosIconPng: "assets/nightly/aprende-nightly-ios-1024.png",
  nightlyMacIconPng: "assets/nightly/aprende-nightly-macos-1024.png",
  nightlyLinuxIconPng: "assets/nightly/aprende-nightly-universal-1024.png",
  nightlyWindowsIconIco: "assets/nightly/aprende-nightly-windows.ico",
  nightlyWebFaviconIco: "assets/nightly/aprende-nightly-web-favicon.ico",
  nightlyWebFavicon16Png: "assets/nightly/aprende-nightly-web-favicon-16x16.png",
  nightlyWebFavicon32Png: "assets/nightly/aprende-nightly-web-favicon-32x32.png",
  nightlyWebAppleTouchIconPng: "assets/nightly/aprende-nightly-web-apple-touch-180.png",

  developmentDesktopIconPng: "assets/dev/aprende-dev-macos-1024.png",
  developmentWindowsIconIco: "assets/dev/aprende-dev-windows.ico",
  developmentWebFaviconIco: "assets/dev/aprende-dev-web-favicon.ico",
  developmentWebFavicon16Png: "assets/dev/aprende-dev-web-favicon-16x16.png",
  developmentWebFavicon32Png: "assets/dev/aprende-dev-web-favicon-32x32.png",
  developmentWebAppleTouchIconPng: "assets/dev/aprende-dev-web-apple-touch-180.png",
} as const;

export type WebAssetBrand = "development" | "nightly" | "production";

export const WEB_ASSET_CHANNELS = ["latest", "nightly"] as const;

export type WebAssetChannel = (typeof WEB_ASSET_CHANNELS)[number];

export function resolveWebAssetBrandForChannel(channel: WebAssetChannel): WebAssetBrand {
  return channel === "nightly" ? "nightly" : "production";
}

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

const WEB_ICON_TARGET_FILENAMES = {
  faviconIco: "favicon.ico",
  favicon16Png: "favicon-16x16.png",
  favicon32Png: "favicon-32x32.png",
  appleTouchIconPng: "apple-touch-icon.png",
} as const;

const WEB_ICON_SOURCE_PATHS_BY_BRAND = {
  development: {
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
  },
  nightly: {
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
  },
  production: {
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
  },
} as const satisfies Record<WebAssetBrand, Record<keyof typeof WEB_ICON_TARGET_FILENAMES, string>>;

export function resolveWebIconOverrides(
  brand: WebAssetBrand,
  targetDirectory: string,
): ReadonlyArray<IconOverride> {
  const sourcePaths = WEB_ICON_SOURCE_PATHS_BY_BRAND[brand];
  return [
    {
      sourceRelativePath: sourcePaths.faviconIco,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.faviconIco}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon16Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon16Png}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon32Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon32Png}`,
    },
    {
      sourceRelativePath: sourcePaths.appleTouchIconPng,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.appleTouchIconPng}`,
    },
  ];
}

export const DEVELOPMENT_ICON_OVERRIDES = resolveWebIconOverrides("development", "dist/client");

export const DEVELOPMENT_PUBLIC_ICON_OVERRIDES = resolveWebIconOverrides(
  "development",
  "apps/web/public",
);
