import { HTML_RENDER_DEFAULT_FONTS, htmlRenderTheme } from "@aprende/shared/htmlRender";
import { APP_THEME_COLORS } from "@aprende/shared/themePalettes";

import { appearanceFontStack } from "../appearanceFonts";
import { useClientSettings } from "./useSettings";
import { useTheme } from "./useTheme";

export function useHtmlRenderTheme() {
  const { resolvedTheme } = useTheme();
  const sans = useClientSettings((settings) => settings.fontFamilySans);
  const mono = useClientSettings((settings) => settings.fontFamilyCode);
  return htmlRenderTheme(APP_THEME_COLORS[resolvedTheme], resolvedTheme, {
    sans: appearanceFontStack(sans, HTML_RENDER_DEFAULT_FONTS.sans),
    mono: appearanceFontStack(mono, HTML_RENDER_DEFAULT_FONTS.mono),
  });
}
