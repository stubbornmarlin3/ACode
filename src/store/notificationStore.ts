import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "./layoutStore";

const MAX_NOTIFICATIONS = 50;

export interface AppNotification {
  id: string;
  sessionId: string;
  sessionType: "terminal" | "claude" | "github";
  projectPath: string;
  projectName: string;
  message: string;
  timestamp: number;
  read: boolean;
}

export interface BannerToast {
  id: string;
  notification: AppNotification;
  placement: "project-rail" | "collapsed-pill" | "silent";
  /** Used to trigger fade-out before removal */
  fading: boolean;
}

/** Track banner auto-dismiss timers so they can be cancelled on manual dismiss */
const _bannerTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function clearBannerTimer(id: string) {
  if (_bannerTimers[id]) {
    clearTimeout(_bannerTimers[id]);
    delete _bannerTimers[id];
  }
}

interface NotificationStore {
  notifications: AppNotification[];
  unreadCount: number;
  banners: BannerToast[];
  centerOpen: boolean;

  addNotification: (n: Omit<AppNotification, "id" | "timestamp" | "read">) => void;
  dismiss: (id: string) => void;
  clearAll: () => void;
  markAllRead: () => void;
  markRead: (id: string) => void;
  setCenterOpen: (open: boolean) => void;
  removeBanner: (id: string) => void;
  fadeBanner: (id: string) => void;
  loadFromDisk: () => Promise<void>;
}

function getNotificationsPath(): string {
  // Store in a well-known location relative to user home
  return ".acode-global/notifications.json";
}

async function persistNotifications(notifications: AppNotification[]): Promise<void> {
  try {
    // Use the home dir approach — write to %USERPROFILE%/.acode-global/notifications.json
    const homePath = await invoke<string>("get_home_dir");
    const filePath = homePath.replace(/\\/g, "/") + "/" + getNotificationsPath();
    await invoke("save_file", { path: filePath, content: JSON.stringify({ notifications }, null, 2) });
  } catch {
    // Silently fail — notifications are best-effort persistence
  }
}

async function loadNotifications(): Promise<AppNotification[]> {
  try {
    const homePath = await invoke<string>("get_home_dir");
    const filePath = homePath.replace(/\\/g, "/") + "/" + getNotificationsPath();
    const content = await invoke<string>("read_file_contents", { path: filePath });
    const data = JSON.parse(content) as { notifications: AppNotification[] };
    return data.notifications ?? [];
  } catch {
    return [];
  }
}

export const useNotificationStore = create<NotificationStore>()(devtools((set, get) => ({
  notifications: [],
  unreadCount: 0,
  banners: [],
  centerOpen: false,

  addNotification: (n) => {
    const notification: AppNotification = {
      ...n,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      read: false,
    };

    set((s) => {
      let notifications = [notification, ...s.notifications];
      if (notifications.length > MAX_NOTIFICATIONS) {
        notifications = notifications.slice(0, MAX_NOTIFICATIONS);
      }
      const unreadCount = notifications.filter((n) => !n.read).length;

      // Determine banner placement
      const layout = useLayoutStore.getState();
      const activeProjectId = layout.projects.activeProjectId;
      const activeProject = layout.projects.projects.find(
        (p) => p.id === activeProjectId
      );
      const isActiveProject = activeProject?.path === notification.projectPath;

      let placement: BannerToast["placement"] = "project-rail";
      if (isActiveProject) {
        const isPillExpanded = layout.pillBar.expandedPillIds.includes(notification.sessionId);
        const isPanelOpen = layout.pillBar.openPanelIds.includes(notification.sessionId);
        if (isPillExpanded && isPanelOpen) {
          placement = "silent";
        } else {
          placement = "collapsed-pill";
        }
      }

      const banner: BannerToast = {
        id: notification.id,
        notification,
        placement,
        fading: false,
      };

      const banners = placement !== "silent" ? [...s.banners, banner] : s.banners;

      // Auto-dismiss banner after 4s (timer is tracked so manual dismiss can cancel it)
      if (placement !== "silent") {
        const fadeTimer = setTimeout(() => {
          get().fadeBanner(notification.id);
          const removeTimer = setTimeout(() => {
            get().removeBanner(notification.id);
            delete _bannerTimers[notification.id];
          }, 400);
          _bannerTimers[notification.id] = removeTimer;
        }, 4000);
        _bannerTimers[notification.id] = fadeTimer;
      }

      persistNotifications(notifications);
      return { notifications, unreadCount, banners };
    });
  },

  dismiss: (id) => {
    clearBannerTimer(id);
    set((s) => {
      const notifications = s.notifications.filter((n) => n.id !== id);
      const banners = s.banners.filter((b) => b.id !== id);
      const unreadCount = notifications.filter((n) => !n.read).length;
      persistNotifications(notifications);
      return { notifications, unreadCount, banners };
    });
  },

  clearAll: () => {
    set({ notifications: [], unreadCount: 0 });
    persistNotifications([]);
  },

  markAllRead: () =>
    set((s) => {
      const notifications = s.notifications.map((n) => ({ ...n, read: true }));
      persistNotifications(notifications);
      return { notifications, unreadCount: 0 };
    }),

  markRead: (id) =>
    set((s) => {
      const notifications = s.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      );
      const unreadCount = notifications.filter((n) => !n.read).length;
      persistNotifications(notifications);
      return { notifications, unreadCount };
    }),

  setCenterOpen: (open) => {
    set({ centerOpen: open });
    if (open) {
      // Mark all as read when opening the center
      get().markAllRead();
    }
  },

  removeBanner: (id) => {
    clearBannerTimer(id);
    set((s) => ({
      banners: s.banners.filter((b) => b.id !== id),
    }));
  },

  fadeBanner: (id) =>
    set((s) => ({
      banners: s.banners.map((b) =>
        b.id === id ? { ...b, fading: true } : b
      ),
    })),

  loadFromDisk: async () => {
    const notifications = await loadNotifications();
    const unreadCount = notifications.filter((n) => !n.read).length;
    set({ notifications, unreadCount });
  },
}), { name: "notificationStore", enabled: import.meta.env.DEV }));
