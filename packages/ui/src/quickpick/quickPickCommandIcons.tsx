import {
  BookOpenIcon,
  FileDiffIcon,
  FolderOpenIcon,
  GlobeIcon,
  MessageCirclePlus,
  MoonIcon,
  PanelLeft,
  ServerIcon,
  SettingsIcon,
  SquareTerminalIcon,
  SunIcon,
  WandSparkles,
} from "@/components/icons/tabler.js";
import type { QuickPickCommandIcon } from "@/quickpick/quickPickCommands.js";

export const QUICK_PICK_ICON_BY_KIND = {
  book: BookOpenIcon,
  browser: GlobeIcon,
  diff: FileDiffIcon,
  folder: FolderOpenIcon,
  message: MessageCirclePlus,
  mcp: ServerIcon,
  settings: SettingsIcon,
  sidebarClose: PanelLeft,
  sidebarOpen: PanelLeft,
  skills: WandSparkles,
  themeDark: MoonIcon,
  themeLight: SunIcon,
  terminal: SquareTerminalIcon,
} satisfies Record<QuickPickCommandIcon, typeof MessageCirclePlus>;
