"use client";

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { playOrderConfirmedChime, playNewMessageChime } from "@/lib/audio-chimes";
import { useDashboardContext } from "./DashboardProvider";

export type NotificationContextType = {
  unreadMessagesCount: number;
  unseenOrdersCount: number;
  hasNewOrderAlert: boolean;
  hasNewMessageAlert: boolean;
  isNotificationSupported: boolean;
  notificationPermission: NotificationPermission | "unsupported";
  requestNotificationPermission: () => Promise<NotificationPermission>;
  isInstallable: boolean;
  installApp: () => Promise<void>;
  markOrdersSeen: () => void;
  markMessagesSeen: () => void;
  playOrderSound: () => void;
  playMessageSound: () => void;
};

const NotificationContext = createContext<NotificationContextType | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error("useNotifications must be used within a NotificationProvider");
  }
  return ctx;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { selectedBranchId, isSoundEnabled, profile } = useDashboardContext();

  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);
  const [unseenOrdersCount, setUnseenOrdersCount] = useState(0);
  const [hasNewOrderAlert, setHasNewOrderAlert] = useState(false);
  const [hasNewMessageAlert, setHasNewMessageAlert] = useState(false);

  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);

  // Track acknowledged timestamps & processed event IDs to avoid duplicate alerts
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const lastSeenOrderTimeRef = useRef<number>(Date.now());
  const lastSeenMessageTimeRef = useRef<number>(Date.now());
  const isInitialLoadRef = useRef(true);

  // Check notification support on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      if ("Notification" in window) {
        setNotificationPermission(Notification.permission);
      } else {
        setNotificationPermission("unsupported");
      }

      // Restore last seen timestamp from localStorage
      const storedOrderSeen = localStorage.getItem("dashboard_last_seen_orders_at");
      if (storedOrderSeen) {
        lastSeenOrderTimeRef.current = Number(storedOrderSeen);
      }
      const storedMsgSeen = localStorage.getItem("dashboard_last_seen_messages_at");
      if (storedMsgSeen) {
        lastSeenMessageTimeRef.current = Number(storedMsgSeen);
      }

      // Capture PWA install prompt
      const handleBeforeInstall = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setIsInstallable(true);
      };

      const handleAppInstalled = () => {
        setIsInstallable(false);
        setDeferredPrompt(null);
        toast.success(`${profile.app_name} installed successfully!`);
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstall);
      window.addEventListener("appinstalled", handleAppInstalled);

      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
        window.removeEventListener("appinstalled", handleAppInstalled);
      };
    }
  }, []);

  // Trigger PWA install
  const installApp = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === "accepted") {
        setIsInstallable(false);
        setDeferredPrompt(null);
      }
    } catch (err) {
      console.warn("[PWA] Install error:", err);
    }
  }, [deferredPrompt]);

  // Request native push/device notification permission
  const requestNotificationPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported" as NotificationPermission;
    }
    try {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      if (perm === "granted") {
        toast.success("Device notifications enabled!");
      }
      return perm;
    } catch (err) {
      console.warn("[Notifications] Request error:", err);
      return "denied" as NotificationPermission;
    }
  }, []);

  // Trigger native device notification (via ServiceWorker when available, fallback to Notification API)
  const triggerDeviceNotification = useCallback((title: string, options: NotificationOptions & { url?: string }) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    try {
      // Vibrate mobile device if supported
      if ("vibrate" in navigator) {
        navigator.vibrate([200, 100, 200]);
      }

      // Try via service worker registration first (more reliable when backgrounded)
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "SHOW_NOTIFICATION",
          title,
          options: {
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            ...options,
          },
        });
        return;
      }

      // Standard desktop fallback
      const notif = new Notification(title, {
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        ...options,
      });

      notif.onclick = () => {
        window.focus();
        if (options.url) {
          window.location.href = options.url;
        }
        notif.close();
      };
    } catch (e) {
      console.warn("[Notifications] Could not trigger native notification:", e);
    }
  }, []);

  // Sound triggers
  const playOrderSound = useCallback(() => {
    if (isSoundEnabled) playOrderConfirmedChime();
  }, [isSoundEnabled]);

  const playMessageSound = useCallback(() => {
    if (isSoundEnabled) playNewMessageChime();
  }, [isSoundEnabled]);

  // Mark Orders Seen
  const markOrdersSeen = useCallback(() => {
    setHasNewOrderAlert(false);
    setUnseenOrdersCount(0);
    const now = Date.now();
    lastSeenOrderTimeRef.current = now;
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboard_last_seen_orders_at", String(now));
    }
  }, []);

  // Mark Messages Seen
  const markMessagesSeen = useCallback(() => {
    setHasNewMessageAlert(false);
    const now = Date.now();
    lastSeenMessageTimeRef.current = now;
    if (typeof window !== "undefined") {
      localStorage.setItem("dashboard_last_seen_messages_at", String(now));
    }
  }, []);

  // Auto-clear alert when user is currently viewing the corresponding page
  useEffect(() => {
    if (pathname.startsWith("/dashboard/orders")) {
      markOrdersSeen();
    }
    if (pathname.startsWith("/dashboard/conversations")) {
      markMessagesSeen();
    }
  }, [pathname, markOrdersSeen, markMessagesSeen]);

  // Polling heartbeat (fetches notification status every 5 seconds)
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const branchQuery = selectedBranchId === "all" ? "" : `?branch_id=${encodeURIComponent(selectedBranchId)}`;
        const res = await fetch(`/api/dashboard/notifications${branchQuery}`, {
          cache: "no-store",
          headers: { "ngrok-skip-browser-warning": "true" },
        });
        if (!res.ok) return;
        const data = await res.json();

        // 1. Check for new orders
        if (data.latestOrder) {
          const order = data.latestOrder;
          const orderTime = new Date(order.time).getTime();

          if (!knownOrderIdsRef.current.has(order.id)) {
            knownOrderIdsRef.current.add(order.id);

            // If not initial boot and placed after last seen
            if (!isInitialLoadRef.current && orderTime > lastSeenOrderTimeRef.current) {
              setHasNewOrderAlert(true);
              setUnseenOrdersCount((prev) => prev + 1);
              playOrderSound();

              toast.success(`🎉 New Order #${order.orderNumber} Confirmed!`, {
                description: `${order.type.toUpperCase()} • Rs. ${order.total} from ${order.customer}`,
                duration: 6000,
                action: {
                  label: "View Order",
                  onClick: () => {
                    window.location.href = "/dashboard/orders";
                  },
                },
              });

              triggerDeviceNotification(`🎉 New Order #${order.orderNumber} Confirmed!`, {
                body: `${order.type.toUpperCase()} • Rs. ${order.total} from ${order.customer}`,
                tag: `order-${order.id}`,
                url: "/dashboard/orders",
              });
            }
          }
        }

        // 2. Check for new messages
        setUnreadMessagesCount(data.unreadMessagesCount || 0);

        if (data.latestMessage) {
          const msg = data.latestMessage;
          const msgTime = new Date(msg.time).getTime();

          if (!knownMessageIdsRef.current.has(msg.id)) {
            knownMessageIdsRef.current.add(msg.id);

            if (!isInitialLoadRef.current && msgTime > lastSeenMessageTimeRef.current) {
              setHasNewMessageAlert(true);
              playMessageSound();

              toast.info(`💬 Message from ${msg.from}`, {
                description: msg.content.length > 60 ? msg.content.slice(0, 60) + "..." : msg.content,
                duration: 5000,
                action: {
                  label: "Reply",
                  onClick: () => {
                    window.location.href = "/dashboard/conversations";
                  },
                },
              });

              triggerDeviceNotification(`💬 Message from ${msg.from}`, {
                body: msg.content,
                tag: `msg-${msg.id}`,
                url: "/dashboard/conversations",
              });
            }
          }
        }

        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
        }
      } catch (err) {
        // Silent retry
      }
    };

    void fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [selectedBranchId, playOrderSound, playMessageSound, triggerDeviceNotification]);

  // Real-time Supabase WebSockets listener
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase
      .channel("dashboard-realtime-notifications")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const newOrder = payload.new as any;
          if (newOrder && !knownOrderIdsRef.current.has(newOrder.id)) {
            knownOrderIdsRef.current.add(newOrder.id);
            setHasNewOrderAlert(true);
            setUnseenOrdersCount((prev) => prev + 1);
            playOrderSound();

            toast.success(`🎉 New Order #${newOrder.order_number} Confirmed!`, {
              description: `${newOrder.type?.toUpperCase()} • Rs. ${newOrder.total}`,
              action: {
                label: "View",
                onClick: () => {
                  window.location.href = "/dashboard/orders";
                },
              },
            });

            triggerDeviceNotification(`🎉 New Order #${newOrder.order_number} Confirmed!`, {
              body: `${newOrder.type?.toUpperCase()} • Rs. ${newOrder.total}`,
              tag: `order-${newOrder.id}`,
              url: "/dashboard/orders",
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const newMsg = payload.new as any;
          if (newMsg && newMsg.role === "user" && !knownMessageIdsRef.current.has(newMsg.id)) {
            knownMessageIdsRef.current.add(newMsg.id);
            setHasNewMessageAlert(true);
            setUnreadMessagesCount((prev) => prev + 1);
            playMessageSound();

            toast.info("💬 New WhatsApp Customer Message", {
              description: newMsg.content?.slice(0, 50) || "Customer sent a message",
              action: {
                label: "Open Chat",
                onClick: () => {
                  window.location.href = "/dashboard/conversations";
                },
              },
            });

            triggerDeviceNotification("💬 New WhatsApp Customer Message", {
              body: newMsg.content?.slice(0, 70) || "Customer sent a message",
              tag: `msg-${newMsg.id}`,
              url: "/dashboard/conversations",
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [playOrderSound, playMessageSound, triggerDeviceNotification]);

  const value = {
    unreadMessagesCount,
    unseenOrdersCount,
    hasNewOrderAlert,
    hasNewMessageAlert,
    isNotificationSupported: notificationPermission !== "unsupported",
    notificationPermission,
    requestNotificationPermission,
    isInstallable,
    installApp,
    markOrdersSeen,
    markMessagesSeen,
    playOrderSound,
    playMessageSound,
  };

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
