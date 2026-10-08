import {
  Folder,
  Laptop,
  GitBranch,
  Plus,
  Settings,
  Paperclip,
  ArrowUp,
  Square,
  Copy,
  Check,
  Trash2,
  RefreshCw,
  Globe,
  Terminal,
  FileText,
  Search,
  PanelLeft,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  FileDiff,
  ExternalLink,
  Gauge,
  Pin,
  MessageCircle,
  Hand,
  ShieldAlert,
  ShieldCheck,
  Video,
  Music,
  Image,
  Presentation,
  FileSpreadsheet,
  FileCode,
  FileArchive,
  type UiIconProps,
} from "@/components/icons/tabler.js";
import type { ComponentType } from "react";
import { WriteIcon } from "@/components/ui/write-icon.js";

// 图标直接复用宿主 Tabler/WriteIcon，避免模式切换后轮廓、描边和品牌改变。
function hostIcon(Icon: ComponentType<UiIconProps>) {
  return function MyChatIcon({ size = 16 }: { size?: number }) {
    return <Icon size={size} aria-hidden />;
  };
}

export const IconFolder = hostIcon(Folder);
export const IconLaptop = hostIcon(Laptop);
export const IconBranch = hostIcon(GitBranch);
export const IconPlus = hostIcon(Plus);
export const IconGear = hostIcon(Settings);
export const IconPaperclip = hostIcon(Paperclip);
export const IconArrowUp = hostIcon(ArrowUp);
export const IconStop = hostIcon(Square);
export const IconCopy = hostIcon(Copy);
export const IconCheck = hostIcon(Check);
export const IconTrash = hostIcon(Trash2);
export const IconRefresh = hostIcon(RefreshCw);
export const IconGlobe = hostIcon(Globe);
export const IconPencil = hostIcon(WriteIcon);
export const IconTerminal = hostIcon(Terminal);
export const IconFileText = hostIcon(FileText);
export const IconSearch = hostIcon(Search);
export const IconSidebar = hostIcon(PanelLeft);
export const IconCompose = hostIcon(WriteIcon);
export const IconChevronDown = hostIcon(ChevronDown);
export const IconChevronUp = hostIcon(ChevronUp);
export const IconChevronRight = hostIcon(ChevronRight);
export const IconChanges = hostIcon(FileDiff);
export const IconExternal = hostIcon(ExternalLink);
export const IconGithub = hostIcon(GitBranch);
export const IconGauge = hostIcon(Gauge);
export const IconMyChat = hostIcon(PanelLeft);
export const IconPin = hostIcon(Pin);
export const IconChatBubble = hostIcon(MessageCircle);
export const IconHand = hostIcon(Hand);
export const IconShield = hostIcon(ShieldAlert);
export const IconAutoApprove = hostIcon(ShieldCheck);
export const IconVideo = hostIcon(Video);
export const IconMusic = hostIcon(Music);
export const IconImage = hostIcon(Image);
export const IconFilePdf = hostIcon(FileText);
export const IconFilePpt = hostIcon(Presentation);
export const IconFileWord = hostIcon(FileText);
export const IconFileSpreadsheet = hostIcon(FileSpreadsheet);
export const IconCode = hostIcon(FileCode);
export const IconArchive = hostIcon(FileArchive);
