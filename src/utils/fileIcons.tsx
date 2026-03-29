import React from "react";
import {
  FileText,
  FileCode,
  FileJson,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileSpreadsheet,
  File,
  Settings,
  Lock,
  Database,
  Braces,
  Hash,
  Coffee,
  Gem,
  Globe,
  Palette,
  Terminal,
  FileType,
  BookOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface FileIconInfo {
  icon: LucideIcon;
  color: string;
}

const EXT_MAP: Record<string, FileIconInfo> = {
  // JavaScript / TypeScript
  js:   { icon: Braces, color: "#f7df1e" },
  jsx:  { icon: Braces, color: "#61dafb" },
  ts:   { icon: Braces, color: "#3178c6" },
  tsx:  { icon: Braces, color: "#3178c6" },
  mjs:  { icon: Braces, color: "#f7df1e" },
  cjs:  { icon: Braces, color: "#f7df1e" },

  // Web
  html: { icon: Globe, color: "#e44d26" },
  htm:  { icon: Globe, color: "#e44d26" },
  css:  { icon: Palette, color: "#563d7c" },
  scss: { icon: Palette, color: "#cd6799" },
  sass: { icon: Palette, color: "#cd6799" },
  less: { icon: Palette, color: "#1d365d" },
  svg:  { icon: FileImage, color: "#ffb13b" },

  // Data / Config
  json: { icon: FileJson, color: "#cbcb41" },
  yaml: { icon: FileText, color: "#cb171e" },
  yml:  { icon: FileText, color: "#cb171e" },
  toml: { icon: Settings, color: "#9c4121" },
  xml:  { icon: FileCode, color: "#e37933" },
  ini:  { icon: Settings, color: "#6d8086" },
  env:  { icon: Lock, color: "#ecd53f" },

  // Markdown / Docs
  md:       { icon: BookOpen, color: "#519aba" },
  mdx:      { icon: BookOpen, color: "#519aba" },
  txt:      { icon: FileText, color: "#89a0b0" },
  rst:      { icon: FileText, color: "#89a0b0" },
  adoc:     { icon: FileText, color: "#89a0b0" },

  // Python
  py:   { icon: FileCode, color: "#3572a5" },
  pyi:  { icon: FileCode, color: "#3572a5" },
  pyc:  { icon: FileCode, color: "#3572a5" },
  pyx:  { icon: FileCode, color: "#3572a5" },

  // Rust
  rs:   { icon: Settings, color: "#dea584" },
  toml_: { icon: Settings, color: "#dea584" }, // handled by toml above

  // Go
  go:   { icon: FileCode, color: "#00add8" },
  mod:  { icon: FileText, color: "#00add8" },
  sum:  { icon: FileText, color: "#00add8" },

  // Java / JVM
  java:   { icon: Coffee, color: "#b07219" },
  kt:     { icon: FileCode, color: "#a97bff" },
  kts:    { icon: FileCode, color: "#a97bff" },
  scala:  { icon: FileCode, color: "#c22d40" },
  groovy: { icon: FileCode, color: "#4298b8" },
  gradle: { icon: FileCode, color: "#02303a" },

  // C / C++
  c:   { icon: Hash, color: "#555555" },
  h:   { icon: Hash, color: "#555555" },
  cpp: { icon: Hash, color: "#f34b7d" },
  cxx: { icon: Hash, color: "#f34b7d" },
  cc:  { icon: Hash, color: "#f34b7d" },
  hpp: { icon: Hash, color: "#f34b7d" },

  // C#
  cs:  { icon: Hash, color: "#178600" },

  // Ruby
  rb:      { icon: Gem, color: "#cc342d" },
  gemspec: { icon: Gem, color: "#cc342d" },

  // PHP
  php: { icon: FileCode, color: "#4f5d95" },

  // Shell
  sh:   { icon: Terminal, color: "#89e051" },
  bash: { icon: Terminal, color: "#89e051" },
  zsh:  { icon: Terminal, color: "#89e051" },
  fish: { icon: Terminal, color: "#89e051" },
  ps1:  { icon: Terminal, color: "#012456" },
  bat:  { icon: Terminal, color: "#c1f12e" },
  cmd:  { icon: Terminal, color: "#c1f12e" },

  // SQL / DB
  sql:    { icon: Database, color: "#e38c00" },
  sqlite: { icon: Database, color: "#003b57" },
  db:     { icon: Database, color: "#003b57" },

  // Images
  png:  { icon: FileImage, color: "#a074c4" },
  jpg:  { icon: FileImage, color: "#a074c4" },
  jpeg: { icon: FileImage, color: "#a074c4" },
  gif:  { icon: FileImage, color: "#a074c4" },
  ico:  { icon: FileImage, color: "#a074c4" },
  bmp:  { icon: FileImage, color: "#a074c4" },
  webp: { icon: FileImage, color: "#a074c4" },

  // Video
  mp4:  { icon: FileVideo, color: "#fd5750" },
  mkv:  { icon: FileVideo, color: "#fd5750" },
  avi:  { icon: FileVideo, color: "#fd5750" },
  mov:  { icon: FileVideo, color: "#fd5750" },
  webm: { icon: FileVideo, color: "#fd5750" },

  // Audio
  mp3:  { icon: FileAudio, color: "#e83e8c" },
  wav:  { icon: FileAudio, color: "#e83e8c" },
  ogg:  { icon: FileAudio, color: "#e83e8c" },
  flac: { icon: FileAudio, color: "#e83e8c" },

  // Archives
  zip:  { icon: FileArchive, color: "#eca517" },
  gz:   { icon: FileArchive, color: "#eca517" },
  tar:  { icon: FileArchive, color: "#eca517" },
  rar:  { icon: FileArchive, color: "#eca517" },
  "7z": { icon: FileArchive, color: "#eca517" },

  // Fonts
  ttf:  { icon: FileType, color: "#a074c4" },
  otf:  { icon: FileType, color: "#a074c4" },
  woff: { icon: FileType, color: "#a074c4" },
  woff2: { icon: FileType, color: "#a074c4" },

  // Spreadsheets
  csv:  { icon: FileSpreadsheet, color: "#207245" },
  xls:  { icon: FileSpreadsheet, color: "#207245" },
  xlsx: { icon: FileSpreadsheet, color: "#207245" },

  // Lock files
  lock: { icon: Lock, color: "#6d8086" },
};

/** Special full-filename matches */
const NAME_MAP: Record<string, FileIconInfo> = {
  "Dockerfile":       { icon: FileCode, color: "#384d54" },
  "docker-compose.yml": { icon: FileCode, color: "#384d54" },
  "docker-compose.yaml": { icon: FileCode, color: "#384d54" },
  ".gitignore":       { icon: Settings, color: "#f05032" },
  ".gitattributes":   { icon: Settings, color: "#f05032" },
  ".editorconfig":    { icon: Settings, color: "#fff2f0" },
  ".prettierrc":      { icon: Settings, color: "#56b3b4" },
  ".eslintrc":        { icon: Settings, color: "#4b32c3" },
  "Makefile":         { icon: Terminal, color: "#6d8086" },
  "CMakeLists.txt":   { icon: Settings, color: "#064f8c" },
  "Cargo.toml":       { icon: Settings, color: "#dea584" },
  "Cargo.lock":       { icon: Lock, color: "#dea584" },
  "package.json":     { icon: FileJson, color: "#e8274b" },
  "package-lock.json": { icon: Lock, color: "#cb3837" },
  "tsconfig.json":    { icon: FileJson, color: "#3178c6" },
  "vite.config.ts":   { icon: Settings, color: "#646cff" },
  "vite.config.js":   { icon: Settings, color: "#646cff" },
  "tailwind.config.js": { icon: Settings, color: "#38bdf8" },
  "tailwind.config.ts": { icon: Settings, color: "#38bdf8" },
  "LICENSE":          { icon: FileText, color: "#d4aa00" },
  "README.md":        { icon: BookOpen, color: "#519aba" },
};

const DEFAULT_ICON: FileIconInfo = { icon: File, color: "#6d8086" };

export function getFileIcon(filename: string, size = 14): React.ReactElement {
  // Check full name first
  const nameInfo = NAME_MAP[filename];
  if (nameInfo) {
    const Icon = nameInfo.icon;
    return <Icon size={size} color={nameInfo.color} />;
  }

  // Extract extension
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx > 0) {
    const ext = filename.slice(dotIdx + 1).toLowerCase();
    const extInfo = EXT_MAP[ext];
    if (extInfo) {
      const Icon = extInfo.icon;
      return <Icon size={size} color={extInfo.color} />;
    }
  }

  const Icon = DEFAULT_ICON.icon;
  return <Icon size={size} color={DEFAULT_ICON.color} />;
}
